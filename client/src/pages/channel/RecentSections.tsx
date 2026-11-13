import type { ReactNode } from 'react';
import { Activity, Ban, CheckCircle2, ChevronDown, CircleAlert, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { VideoCard } from '../../components/VideoCard';
import { absolute, duration, relativeTime } from '../../format';
import { RUN_STATE_LABEL, RUN_TRIGGER_LABEL, stageLabel } from '../../labels';
import { useVideoActions } from '../../hooks/useVideoActions';
import type { Run, RunState, Video } from '../../types';

export function RecentVideosSection({
  channelId,
  videos,
  onChanged,
}: {
  channelId: number;
  videos: Video[] | null;
  onChanged: () => void;
}) {
  const { actions, busy, modals } = useVideoActions(onChanged);
  let body: ReactNode;
  if (videos === null) body = <p className="text-ink-soft">Loading videos...</p>;
  else if (videos.length === 0)
    body = <EmptyState title="No videos from this channel yet.">Make the first one from the production line above.</EmptyState>;
  else
    body = (
      <div className="max-h-[34rem] overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} showChannel={false} busy={busy} actions={actions} />
          ))}
        </div>
      </div>
    );
  const newest = videos && videos.length ? videos[0] : null;
  return (
    <Section title="Recent videos" description="The latest six videos from this channel.">
      <details className="group rounded-[10px] border border-line bg-sheet">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{videos ? `${videos.length} video${videos.length === 1 ? '' : 's'}` : 'Videos'}</span>
            {newest && <span className="min-w-0 truncate text-[14px] font-normal text-ink-soft">Latest: {newest.title}</span>}
          </span>
          <ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-line">{body}</div>
      </details>
      <a href={`#/videos?channel=${channelId}`} className="w-fit rounded-md text-[15px] font-semibold underline underline-offset-4">
        All videos from this channel
      </a>
      {modals}
    </Section>
  );
}

const RESULT: Record<Exclude<RunState, 'idle'>, { icon: LucideIcon; tone: string }> = {
  done: { icon: CheckCircle2, tone: 'text-leaf-ink' },
  error: { icon: CircleAlert, tone: 'text-apple-deep' },
  cancelled: { icon: Ban, tone: 'text-ink-soft' },
  running: { icon: Activity, tone: 'text-ink' },
  waiting_login: { icon: Clock, tone: 'text-honey-ink' },
};

export function RecentRunsSection({ runs }: { runs: Run[] | null }) {
  let body: ReactNode;
  if (runs === null) body = <p className="text-ink-soft">Loading runs...</p>;
  else if (runs.length === 0) body = <EmptyState title="Nothing has run for this channel yet." />;
  else
    body = (
      <ol className="divide-y divide-line rounded-[10px] border border-line bg-sheet">
        {runs.map((r) => {
          const { icon: Icon, tone } = RESULT[r.state];
          const took = duration(r.duration_sec);
          return (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-[14px]">
              <span className={`inline-flex items-center gap-1.5 font-semibold ${tone}`}>
                <Icon className="size-4 shrink-0 self-center" aria-hidden="true" />
                {RUN_STATE_LABEL[r.state]}
              </span>
              <span className="text-ink-soft" title={absolute(r.started_at)}>
                {relativeTime(r.started_at)}
              </span>
              <span>{RUN_TRIGGER_LABEL[r.trigger]}</span>
              {stageLabel(r.stage) && <span className="text-ink-soft">Reached: {stageLabel(r.stage)}</span>}
              {took && <span className="text-ink-soft">{took}</span>}
              <span className="min-w-0 flex-1 basis-full text-ink-soft sm:basis-auto">{r.message}</span>
            </li>
          );
        })}
      </ol>
    );
  const latest = runs && runs.length ? runs[0] : null;
  return (
    <Section title="Recent runs" description="Each time this channel made a video, or tried to. Newest first.">
      <details className="group rounded-[10px] border border-line bg-sheet">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{runs ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'Runs'}</span>
            {latest && (
              <span className="text-[14px] font-normal text-ink-soft">
                Latest: {RUN_STATE_LABEL[latest.state]}, {relativeTime(latest.started_at)}
              </span>
            )}
          </span>
          <ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="max-h-[28rem] overflow-y-auto border-t border-line">{body}</div>
      </details>
    </Section>
  );
}
