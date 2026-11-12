/**
 * Series schedules: a run of videos spaced by a fixed step ("every 2 hours") or by random gaps.
 * Pure functions only (no files, no launchd) so the rules can be tested directly.
 *
 * The output is a list of HH:MM launch times for one day. The rest of the scheduler (launchd, slots, state) treats
 * that list exactly like the plain "times" schedule.
 */

/** Random gaps: at least 30 minutes, and never 2 hours or more ("1 less than 2 hours apart" = up to 1 h 59 min). */
export const RANDOM_MIN_GAP = 30;
export const RANDOM_MAX_GAP = 119;
export const EVERY_CHOICES = [15, 60, 120] as const;

export type SeriesConfig =
  | { mode: 'every'; everyMinutes: 15 | 60 | 120; start: string; end: string }
  | { mode: 'random'; start: string; end: string };

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function toMinutes(t: string): number {
  const m = TIME_RE.exec((t || '').trim());
  if (!m) throw new Error(`"${t}" is not a valid time. Use HH:MM, for example 18:30.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`"${t}" is not a valid time (00:00 – 23:59).`);
  return h * 60 + min;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Check and tidy the config a client sent. Throws a message the user can read. */
export function parseSeries(input: any): SeriesConfig {
  if (!input || typeof input !== 'object') throw new Error('Choose a series pattern.');
  const start = toMinutes(String(input.start ?? ''));
  const end = toMinutes(String(input.end ?? ''));
  if (end <= start) throw new Error('The end time must be after the start time, on the same day.');
  const startS = formatMinutes(start);
  const endS = formatMinutes(end);
  if (input.mode === 'every') {
    const everyMinutes = Number(input.everyMinutes);
    if (!(EVERY_CHOICES as readonly number[]).includes(everyMinutes)) {
      throw new Error('Pick a step of 15 minutes, 1 hour or 2 hours.');
    }
    return { mode: 'every', everyMinutes: everyMinutes as 15 | 60 | 120, start: startS, end: endS };
  }
  if (input.mode === 'random') return { mode: 'random', start: startS, end: endS };
  throw new Error('Unknown series pattern.');
}

/** Fixed step: start, start + step, … up to and including the end time. */
export function planEveryDay(cfg: Extract<SeriesConfig, { mode: 'every' }>): string[] {
  const start = toMinutes(cfg.start);
  const end = toMinutes(cfg.end);
  const times: string[] = [];
  for (let t = start; t <= end; t += cfg.everyMinutes) times.push(formatMinutes(t));
  return times;
}

/** Stable key for a day's times, used to remember which patterns were already used. */
export const patternKey = (times: string[]) => times.join(',');

/**
 * Random chain for one day: start, then a random gap each time, never past the end.
 * A day is rejected when its exact time list was used before, or when two gaps in a row are equal, so the same
 * pattern never comes back. `rng` is injectable for tests.
 */
/** Minutes every channel's videos must keep from every other channel's (one Grok account, one Mac). */
export const CHANNEL_GAP_MINUTES = 10;

/** Minutes between two times of day, the short way round midnight (23:55 and 00:03 are 8 minutes apart). */
export function minutesApart(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

/** True when a time is closer than CHANNEL_GAP_MINUTES to any blocked time. */
export const isBlocked = (min: number, blocked: readonly number[]) =>
  blocked.some((b) => minutesApart(min, b) < CHANNEL_GAP_MINUTES);

/**
 * Random chain for one day: first video at the start time (or the first free minute after it), then a random gap
 * each time, never past the end. Every time keeps CHANNEL_GAP_MINUTES from `blocked` (other channels' times), and
 * two gaps in a row are never equal. A day whose exact time list was used before is rejected and drawn again, so the
 * same pattern never comes back. `rng` is injectable for tests.
 */
export function planRandomDay(
  cfg: Extract<SeriesConfig, { mode: 'random' }>,
  used: ReadonlySet<string>,
  rng: () => number = Math.random,
  maxTries = 1000,
  blocked: readonly number[] = []
): { times: string[]; key: string } {
  const start = toMinutes(cfg.start);
  const end = toMinutes(cfg.end);
  let first = -1;
  for (let m = start; m <= end && m < start + RANDOM_MAX_GAP; m++) {
    if (!isBlocked(m, blocked)) {
      first = m;
      break;
    }
  }
  if (first < 0) throw new Error('Other channels have videos all through the start of this window. Pick another start time.');
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const times = [formatMinutes(first)];
    let t = first;
    let prevGap = -1;
    for (;;) {
      const options: number[] = [];
      for (let g = RANDOM_MIN_GAP; g <= RANDOM_MAX_GAP && t + g <= end; g++) {
        if (g !== prevGap && !isBlocked(t + g, blocked)) options.push(g);
      }
      if (!options.length) break;
      const gap = options[Math.floor(rng() * options.length)];
      prevGap = gap;
      t += gap;
      times.push(formatMinutes(t));
    }
    const key = patternKey(times);
    if (!used.has(key)) return { times, key };
  }
  throw new Error('Could not make a new random pattern for this window. Make the window longer.');
}

/**
 * First pair where this channel's times come closer than CHANNEL_GAP_MINUTES to another channel's, or null.
 * `others` = the other ENABLED channels with their times.
 */
export function findClash(
  times: readonly string[],
  others: ReadonlyArray<{ name: string; times: readonly string[] }>
): { time: string; other: string; otherTime: string } | null {
  for (const t of times) {
    const m = toMinutes(t);
    for (const o of others) {
      for (const ot of o.times) {
        if (minutesApart(m, toMinutes(ot)) < CHANNEL_GAP_MINUTES) return { time: formatMinutes(m), other: o.name, otherTime: ot };
      }
    }
  }
  return null;
}

/** Maximum number of distinct day patterns remembered, so the history file stays small. */
export const HISTORY_LIMIT = 1000;
