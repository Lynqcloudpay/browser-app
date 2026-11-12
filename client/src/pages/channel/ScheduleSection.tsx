import { useState } from 'react';
import { api } from '../../api';
import { Section } from '../../components/Section';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toasts';
import { absolute } from '../../format';
import type { ChannelView, SeriesSettings } from '../../types';
import type { PatchFn } from './ChannelHeader';

// Must match the server's MIN_GAP_MINUTES and MAX_POSTS_PER_DAY (server/engine/dailySchedule.ts).
const MIN_GAP = 30;
const MAX_PER_DAY = Math.floor((24 * 60) / MIN_GAP);
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** First half-hour (starting 07:00, wrapping past midnight) that keeps MIN_GAP from every taken time. */
function freeSlot(taken: string[]): string | null {
  const used = taken.map(toMin);
  for (let i = 0; i < MAX_PER_DAY; i++) {
    const candidate = (7 * 60 + i * MIN_GAP) % (24 * 60);
    if (used.every((u) => Math.abs(u - candidate) >= MIN_GAP)) return fmt(candidate);
  }
  return null;
}

type Pattern = 'every15' | 'every60' | 'every120' | 'random';

const PATTERNS: Array<{ key: Pattern; label: string }> = [
  { key: 'every15', label: 'Every 15 minutes' },
  { key: 'every60', label: 'Every hour' },
  { key: 'every120', label: 'Every 2 hours' },
  { key: 'random', label: 'Random gaps (30 min to under 2 hours)' },
];
const EVERY_MINUTES: Record<Exclude<Pattern, 'random'>, 15 | 60 | 120> = { every15: 15, every60: 60, every120: 120 };

function patternOf(s: SeriesSettings | null): Pattern {
  if (!s) return 'every120';
  if (s.mode === 'random') return 'random';
  return s.everyMinutes === 15 ? 'every15' : s.everyMinutes === 60 ? 'every60' : 'every120';
}

export function ScheduleSection({
  channel,
  others,
  patch,
}: {
  channel: ChannelView;
  others: ChannelView[];
  patch: PatchFn;
}) {
  const toast = useToast();
  const saved = channel.schedule_series;
  const [view, setView] = useState<'times' | 'series'>(saved ? 'series' : 'times');
  // A series fills schedule_times with its whole day, so the plain-times list starts from a single time instead.
  const [times, setTimes] = useState<string[]>(
    !saved && channel.schedule_times.length ? channel.schedule_times : ['10:00'],
  );
  const [pattern, setPattern] = useState<Pattern>(patternOf(saved));
  const [start, setStart] = useState(saved?.start ?? '08:00');
  const [end, setEnd] = useState(saved?.end ?? '22:00');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const enabled = channel.schedule_enabled;

  /** Turning posting on or off keeps the saved times and series as they are. */
  const toggle = async (nextEnabled: boolean) => {
    setSaving(true);
    setStatus(null);
    setWarning(null);
    try {
      const updated = await patch({ schedule_enabled: nextEnabled });
      setWarning(updated.scheduleWarning ?? null);
      setStatus(nextEnabled ? 'Daily posting is on.' : 'Schedule paused.');
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const saveTimes = async (nextTimes: string[]) => {
    setSaving(true);
    setStatus(null);
    setWarning(null);
    try {
      await api.saveSchedule(channel.id, { enabled: true, times: nextTimes });
      setStatus(`Daily posting is on, ${nextTimes.length} ${nextTimes.length === 1 ? 'time' : 'times'} a day.`);
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const saveSeries = async () => {
    setSaving(true);
    setStatus(null);
    setWarning(null);
    try {
      const series: SeriesSettings =
        pattern === 'random'
          ? { mode: 'random', start, end }
          : { mode: 'every', everyMinutes: EVERY_MINUTES[pattern], start, end };
      const res = await api.saveSeries(channel.id, { enabled, series });
      const list = res.times.join(', ');
      setStatus(
        enabled
          ? `Series on. Today: ${res.times.length} ${res.times.length === 1 ? 'video' : 'videos'} at ${list}.` +
              (pattern === 'random' ? ' A new random pattern is made each night.' : '')
          : `Series saved. Turn posting on to start. Today would be: ${list}.`,
      );
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const setCount = (n: number) => {
    if (!Number.isInteger(n) || n < 1 || n > MAX_PER_DAY) return;
    let next: string[];
    if (n <= times.length) {
      next = times.slice(0, n);
    } else {
      next = [...times];
      while (next.length < n) {
        const slot = freeSlot(next);
        if (!slot) {
          setWarning(`No room for ${n} videos a day with ${MIN_GAP} minutes between them. The most that fit now is ${next.length}.`);
          return;
        }
        next.push(slot);
      }
    }
    setWarning(null);
    setTimes(next);
    if (enabled) void saveTimes(next);
  };

  const setTime = (index: number, value: string) => {
    const next = times.map((t, i) => (i === index ? value : t));
    setTimes(next);
    if (enabled && value) void saveTimes(next);
  };

  const conflicts = enabled
    ? times.flatMap((time) =>
        others
          .filter((o) => o.schedule_enabled && o.schedule_times.includes(time))
          .map((o) => ({ time, name: o.name })),
      )
    : [];

  const modeButton = (key: 'times' | 'series', label: string) => (
    <button
      type="button"
      aria-pressed={view === key}
      onClick={() => setView(key)}
      className={
        view === key
          ? 'cursor-pointer rounded-[10px] bg-ink px-4 py-2 font-semibold text-white'
          : 'cursor-pointer rounded-[10px] border border-ink-soft bg-sheet px-4 py-2 font-semibold hover:bg-paper'
      }
    >
      {label}
    </button>
  );

  return (
    <Section title="Daily schedule" description="Makes and posts videos on the schedule below, every day.">
      <Switch checked={enabled} disabled={saving} onChange={(v) => void toggle(v)}>
        <span className="block font-semibold">Post on this schedule</span>
        <span className="block text-[14px] text-ink-soft">Turn it off to pause the daily videos.</span>
      </Switch>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Schedule type">
        {modeButton('times', 'Set times')}
        {modeButton('series', 'Series')}
      </div>

      {view === 'times' && (
        <fieldset className="space-y-4">
          <legend className="mb-3 text-[14px] font-semibold">Videos per day</legend>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="schedule-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PER_DAY}
              value={times.length}
              disabled={saving}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-24 rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-semibold"
            />
            <span className="text-[13px] text-ink-soft">
              Any number, from 1 to {MAX_PER_DAY}. Times are at least {MIN_GAP} minutes apart.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {times.map((time, i) => (
              <div key={i}>
                <label htmlFor={`schedule-time-${i}`} className="mb-1 block text-[13px] font-semibold text-ink-soft">
                  Time {i + 1}
                </label>
                <input
                  id={`schedule-time-${i}`}
                  type="time"
                  value={time}
                  onChange={(e) => setTime(i, e.target.value)}
                  className="w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
                />
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {view === 'series' && (
        <fieldset className="space-y-4">
          <legend className="mb-3 text-[14px] font-semibold">Series pattern</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Series pattern">
            {PATTERNS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={pattern === p.key}
                onClick={() => setPattern(p.key)}
                className={
                  pattern === p.key
                    ? 'cursor-pointer rounded-[10px] bg-ink px-4 py-2.5 text-left font-semibold text-white'
                    : 'cursor-pointer rounded-[10px] border border-ink-soft bg-sheet px-4 py-2.5 text-left font-semibold hover:bg-paper'
                }
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="series-start" className="mb-1 block text-[13px] font-semibold text-ink-soft">
                First video
              </label>
              <input
                id="series-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
              />
            </div>
            <div>
              <label htmlFor="series-end" className="mb-1 block text-[13px] font-semibold text-ink-soft">
                Last video by
              </label>
              <input
                id="series-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
              />
            </div>
          </div>

          <p className="text-[13px] text-ink-soft">
            {pattern === 'random'
              ? 'Each gap is random, between 30 minutes and 1 hour 59 minutes. Every night a new pattern is made, and an earlier pattern never comes back.'
              : `A video every ${pattern === 'every15' ? '15 minutes' : pattern === 'every60' ? 'hour' : '2 hours'}, from the first video up to the last one.`}
          </p>

          <button
            type="button"
            onClick={() => void saveSeries()}
            disabled={saving}
            className="cursor-pointer rounded-[10px] bg-ink px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            Save series
          </button>
        </fieldset>
      )}

      {enabled && channel.nextRunAt && (
        <p className="text-[15px]">
          Next video: <span title={absolute(channel.nextRunAt)} className="font-semibold">{absolute(channel.nextRunAt)}</span>
        </p>
      )}
      <p className="text-[13px] text-ink-soft">
        Runs even when this app is closed, as long as the Mac is on. Turn schedules on from one computer only.
      </p>

      {status && (
        <p role="status" className="text-[14px] font-medium text-leaf-ink">
          {status}
        </p>
      )}
      {warning && (
        <p role="alert" className="rounded-[10px] bg-honey-wash p-3 text-[14px] text-honey-ink">
          {warning}
        </p>
      )}
      {conflicts.length > 0 && view === 'times' && (
        <div role="status" className="rounded-[10px] bg-honey-wash p-3 text-[14px] text-honey-ink">
          <p className="font-semibold">Two channels at the same time</p>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.time} runs at the same time as {c.name}.
              </li>
            ))}
          </ul>
          <p className="mt-1.5">
            Both channels run in separate browser windows. Grok video generation is slowed automatically to avoid rate limits.
          </p>
        </div>
      )}
    </Section>
  );
}
