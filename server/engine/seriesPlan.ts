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
export function planRandomDay(
  cfg: Extract<SeriesConfig, { mode: 'random' }>,
  used: ReadonlySet<string>,
  rng: () => number = Math.random,
  maxTries = 1000
): { times: string[]; key: string } {
  const start = toMinutes(cfg.start);
  const end = toMinutes(cfg.end);
  const span = RANDOM_MAX_GAP - RANDOM_MIN_GAP + 1;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const times = [formatMinutes(start)];
    const gaps: number[] = [];
    let t = start;
    for (;;) {
      const gap = RANDOM_MIN_GAP + Math.floor(rng() * span);
      if (t + gap > end) break;
      gaps.push(gap);
      t += gap;
      times.push(formatMinutes(t));
    }
    const key = patternKey(times);
    const repeatedGap = gaps.some((g, i) => i > 0 && g === gaps[i - 1]);
    if (!used.has(key) && !repeatedGap) return { times, key };
  }
  throw new Error('Could not make a new random pattern for this window. Make the window longer.');
}

/** Maximum number of distinct day patterns remembered, so the history file stays small. */
export const HISTORY_LIMIT = 1000;
