import { useState } from 'react';
import { Activity as ActivityIcon, Ban, CheckCircle2, CircleAlert, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, errorMessage } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { absolute, duration, relativeTime } from '../format';
import { RUN_STATE_LABEL, RUN_TRIGGER_LABEL, stageLabel } from '../labels';
import { usePolling } from '../hooks/usePolling';
import { useAppData } from '../state/appData';
import type { Run, RunState } from '../types';

const RESULT_ICON: Record<Exclude<RunState, 'idle'>, LucideIcon> = {
  done: CheckCircle2,
  error: CircleAlert,
  cancelled: Ban,
  running: ActivityIcon,
  waiting_login: Clock,
};

const RESULT_TONE: Record<Exclude<RunState, 'idle'>, string> = {
  done: 'text-leaf-ink',
  error: 'text-apple-deep',
  cancelled: 'text-ink-soft',
  running: 'text-ink',
  waiting_login: 'text-honey-ink',
};

function Result({ state }: { state: Exclude<RunState, 'idle'> }) {
  const Icon = RESULT_ICON[state];
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${RESULT_TONE[state]}`}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {RUN_STATE_LABEL[state]}
    </span>
  );
}

export function ActivityPage() {
  const { channels } = useAppData();
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const anyActive = runs?.some((r) => r.state === 'running' || r.state === 'waiting_login') ?? false;

  usePolling(
    async (isActive) => {
      try {
        const res = await api.runs({ limit: 100, channel_id: channelFilter ? Number(channelFilter) : undefined });
        if (!isActive()) return;
        setRuns(res.runs);
        setLoadError(null);
      } catch (err) {
        if (isActive()) setLoadError(errorMessage(err));
      }
    },
    anyActive ? 5000 : 20000,
    [channelFilter, anyActive],
  );

  return (
    <>
      <PageHeader title="Activity">
        <span>Every run, newest first. Runs refresh while one is making a video.</span>
      </PageHeader>

      <div className="mb-6">
        <label htmlFor="activity-channel" className="mb-1.5 block text-[13px] font-semibold text-ink-soft">
          Channel
        </label>
        <select
          id="activity-channel"
          value={channelFilter}
          onChange={(e) => {
            setRuns(null);
            setChannelFilter(e.target.value);
          }}
          className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
        >
          <option value="">All channels</option>
          {(channels ?? []).map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.name}
            </option>
          ))}
        </select>
      </div>

      {loadError && (
        <p role="alert" className="mb-5 text-[14px] text-apple-deep">
          {loadError}
        </p>
      )}

      {runs === null ? (
        <p className="text-ink-soft">Loading runs...</p>
      ) : runs.length === 0 ? (
        <EmptyState title="Nothing has run yet." />
      ) : (
        <>
          {/* Table on wide screens */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-sheet min-[1100px]:block">
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">Run history</caption>
              <thead className="border-b border-line text-[13px] text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">When</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Channel</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Started by</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Result</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Stage reached</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Duration</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-4 py-3" title={absolute(r.started_at)}>{relativeTime(r.started_at)}</td>
                    <td className="px-4 py-3">
                      <a href={`#/channel/${r.channel_id}`} className="rounded-md font-semibold underline underline-offset-4">
                        {r.channel_name}
                      </a>
                    </td>
                    <td className="px-4 py-3">{RUN_TRIGGER_LABEL[r.trigger]}</td>
                    <td className="px-4 py-3"><Result state={r.state} /></td>
                    <td className="px-4 py-3">{stageLabel(r.stage) || '—'}</td>
                    <td className="px-4 py-3">{duration(r.duration_sec) || '—'}</td>
                    <td className="px-4 py-3">
                      {r.message}
                      {r.job_id && (
                        <>
                          {' '}
                          <a href="#/videos" className="font-semibold underline underline-offset-4">
                            See videos
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked rows on narrow screens */}
          <ul className="space-y-3 min-[1100px]:hidden">
            {runs.map((r) => (
              <li key={r.id} className="rounded-card border border-line bg-sheet p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a href={`#/channel/${r.channel_id}`} className="font-semibold underline underline-offset-4">
                    {r.channel_name}
                  </a>
                  <Result state={r.state} />
                </div>
                <p className="mt-1 text-[13px] text-ink-soft" title={absolute(r.started_at)}>
                  {relativeTime(r.started_at)}, started by {RUN_TRIGGER_LABEL[r.trigger].toLowerCase()}
                  {duration(r.duration_sec) ? `, ${duration(r.duration_sec)}` : ''}
                </p>
                {stageLabel(r.stage) && <p className="mt-1 text-[13px]">Stage reached: {stageLabel(r.stage)}</p>}
                <p className="mt-2 text-[14px]">
                  {r.message}
                  {r.job_id && (
                    <>
                      {' '}
                      <a href="#/videos" className="font-semibold underline underline-offset-4">
                        See videos
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
