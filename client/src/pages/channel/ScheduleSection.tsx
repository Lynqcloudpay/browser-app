import { useState } from 'react';
import { Section } from '../../components/Section';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toasts';
import { absolute } from '../../format';
import type { ChannelView } from '../../types';
import type { PatchFn } from './ChannelHeader';

const DEFAULT_SLOTS = ['10:00', '14:30', '18:30', '21:00', '07:00', '12:00', '16:00', '23:00'];

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
  const [times, setTimes] = useState<string[]>(channel.schedule_times.length ? channel.schedule_times : ['10:00']);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const enabled = channel.schedule_enabled;

  const save = async (nextEnabled: boolean, nextTimes: string[]) => {
    setSaving(true);
    setStatus(null);
    setWarning(null);
    try {
      const updated = await patch({ schedule_enabled: nextEnabled, schedule_times: nextTimes });
      setWarning(updated.scheduleWarning ?? null);
      setStatus(
        nextEnabled
          ? `Daily posting is on, ${nextTimes.length} ${nextTimes.length === 1 ? 'time' : 'times'} a day.`
          : 'Schedule paused.',
      );
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const setCount = (n: number) => {
    let next: string[];
    if (n <= times.length) {
      next = times.slice(0, n);
    } else {
      next = [...times];
      for (const slot of DEFAULT_SLOTS) {
        if (next.length === n) break;
        if (!next.includes(slot)) next.push(slot);
      }
    }
    setTimes(next);
    if (enabled) void save(true, next);
  };

  const setTime = (index: number, value: string) => {
    const next = times.map((t, i) => (i === index ? value : t));
    setTimes(next);
    if (enabled && value) void save(true, next);
  };

  const conflicts = enabled
    ? times.flatMap((time) =>
        others
          .filter((o) => o.schedule_enabled && o.schedule_times.includes(time))
          .map((o) => ({ time, name: o.name })),
      )
    : [];

  return (
    <Section
      title="Daily schedule"
      description="Makes and posts a video at each of these times, every day."
    >
      <Switch checked={enabled} disabled={saving} onChange={(v) => void save(v, times)}>
        <span className="block font-semibold">Post on this schedule</span>
        <span className="block text-[14px] text-ink-soft">Turn it off to pause the daily videos.</span>
      </Switch>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-[14px] font-semibold">Videos per day</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Videos per day">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={times.length === n}
              onClick={() => setCount(n)}
              className={
                times.length === n
                  ? 'size-10 cursor-pointer rounded-[10px] bg-ink font-semibold text-white'
                  : 'size-10 cursor-pointer rounded-[10px] border border-ink-soft bg-sheet font-semibold hover:bg-paper'
              }
            >
              {n}
            </button>
          ))}
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
      {conflicts.length > 0 && (
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
