import { CheckCircle2, CircleAlert, Check, X } from 'lucide-react';
import { useNow } from '../hooks/useNow';
import { mmss } from '../format';
import { STAGES, isRunBusy, platformsText } from '../labels';
import { cx } from '../cx';
import type { ChannelView, RunStatus } from '../types';
import { Button } from './Button';

type StationState = 'done' | 'current' | 'failed' | 'stopped' | 'upcoming';

const WORD: Record<StationState, string> = {
  done: 'Done',
  current: 'Working',
  failed: 'Failed',
  stopped: 'Stopped',
  upcoming: '',
};

function stationStates(run: RunStatus): StationState[] {
  if (run.state === 'done' || run.stage === 'finished') return STAGES.map(() => 'done');
  if (run.state === 'idle') return STAGES.map(() => 'upcoming');
  const idx = Math.max(0, STAGES.findIndex((s) => s.key === run.stage));
  return STAGES.map((_, i) => {
    if (i < idx) return 'done';
    if (i > idx) return 'upcoming';
    if (run.state === 'error') return 'failed';
    if (run.state === 'cancelled') return 'stopped';
    return 'current';
  });
}

export interface ProductionLineProps {
  channel: ChannelView;
  run: RunStatus;
  accountBusy: boolean;
  pending: 'start' | 'stop' | 'skip' | null;
  onStart: () => void;
  onStop: () => void;
  onSkipLogin: () => void;
}

/** The five-station track that shows one video moving from sign-in to post. */
export function ProductionLine({ channel, run, accountBusy, pending, onStart, onStop, onSkipLogin }: ProductionLineProps) {
  const busy = isRunBusy(run);
  const now = useNow(busy);
  const states = stationStates(run);
  const headIdx = states.findIndex((s) => s !== 'done');
  const head = headIdx === -1 ? STAGES.length - 1 : headIdx;
  const platforms = platformsText(channel);
  const blockReason = !platforms
    ? 'Turn on TikTok or YouTube Shorts below before making a video.'
    : accountBusy
      ? 'Wait for the login check or account switch to finish.'
      : null;

  const startedMs = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const endMs = busy || !run.finishedAt ? now : Date.parse(run.finishedAt);
  const elapsed = Number.isNaN(startedMs) ? null : Math.max(0, Math.floor((endMs - startedMs) / 1000));
  const triggerNote =
    run.trigger === 'schedule' && busy
      ? 'Started by the daily schedule'
      : run.trigger === 'republish' && busy
        ? 'Posting an existing video'
        : null;

  return (
    <section aria-labelledby="production-line-heading" className="rounded-card border border-line bg-sheet p-6 sm:p-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="production-line-heading" className="text-[18px] font-bold">
          Production line
        </h2>
        <p className="text-[13px] text-ink-soft">
          {channel.grok_resolution}, {channel.grok_duration}s
        </p>
      </div>

      <div className="relative mt-8">
        <div aria-hidden="true" className="absolute top-[15px] right-[10%] left-[10%] h-[3px] rounded-full bg-line" />
        <div
          aria-hidden="true"
          className="ks-track-fill absolute top-[15px] left-[10%] h-[3px] rounded-full bg-leaf"
          style={{ width: `${(head / (STAGES.length - 1)) * 80}%` }}
        />
        <ol aria-label="Production steps" className="relative grid grid-cols-5 gap-1">
          {STAGES.map((stage, i) => {
            const st = states[i];
            return (
              <li key={stage.key} className="flex min-w-0 flex-col items-center text-center" aria-current={st === 'current' ? 'step' : undefined}>
                <span
                  className={cx(
                    'relative z-10 grid size-[30px] place-items-center rounded-full border-2 bg-sheet',
                    st === 'done' && 'border-leaf bg-leaf text-white',
                    st === 'current' && 'border-apple bg-apple text-white ks-pulse',
                    st === 'failed' && 'border-apple bg-apple text-white',
                    st === 'stopped' && 'border-ink-soft',
                    st === 'upcoming' && 'border-line',
                  )}
                >
                  {st === 'done' && <Check className="size-4" aria-hidden="true" strokeWidth={3} />}
                  {st === 'current' && <span className="size-2.5 rounded-full bg-white" aria-hidden="true" />}
                  {st === 'failed' && <X className="size-4" aria-hidden="true" strokeWidth={3} />}
                </span>
                <span className="mt-2.5 text-[13px] leading-tight font-semibold">{stage.label}</span>
                <span
                  className={cx(
                    'mt-0.5 min-h-[18px] text-[12px] leading-tight',
                    st === 'failed' ? 'font-semibold text-apple-deep' : 'text-ink-soft',
                  )}
                >
                  {WORD[st]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {run.state !== 'idle' && (
        <div className="mt-7 space-y-1">
          <p aria-live="polite" className="text-[16px] font-semibold">
            {run.step}
          </p>
          <p className="text-[13px] text-ink-soft">
            {[elapsed !== null ? `Elapsed ${mmss(elapsed)}` : null, triggerNote].filter(Boolean).join('. ')}
          </p>
        </div>
      )}

      <div className="mt-6">
        {run.state === 'idle' && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button variant="primary" onClick={onStart} disabled={blockReason !== null} busy={pending === 'start'}>
              Make and post a video
            </Button>
            <p className="text-[14px] text-ink-soft">
              Uses {channel.grok_resolution}, {channel.grok_duration}s.{' '}
              {platforms ? `Posts to ${platforms}.` : 'Posts nowhere yet.'}
            </p>
            {blockReason && <p className="w-full text-[14px] font-medium text-honey-ink">{blockReason}</p>}
          </div>
        )}

        {busy && (
          <div className="flex flex-col gap-4">
            {run.state === 'waiting_login' && (
              <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-honey-wash p-4 text-honey-ink">
                <CircleAlert className="size-5 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-[15px]">
                  <strong className="font-semibold">Sign in to continue: </strong>
                  {run.step}
                </p>
                <Button variant="primary" size="sm" onClick={onSkipLogin} busy={pending === 'skip'}>
                  I'm already signed in — continue
                </Button>
              </div>
            )}
            <div>
              <Button variant="secondary" onClick={onStop} busy={pending === 'stop'}>
                Stop
              </Button>
            </div>
          </div>
        )}

        {run.state === 'done' && (
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[10px] bg-leaf-wash px-4 py-3 text-[15px] font-medium text-leaf-ink">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{run.step}</span>
            </p>
            <Button variant="primary" onClick={onStart} disabled={blockReason !== null} busy={pending === 'start'}>
              Make another
            </Button>
          </div>
        )}

        {run.state === 'error' && (
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[10px] bg-apple-wash px-4 py-3 text-[15px] text-apple-deep">
              <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Stopped: </strong>
                {run.error ?? run.step}
              </span>
            </p>
            <Button variant="primary" onClick={onStart} disabled={blockReason !== null} busy={pending === 'start'}>
              Try again
            </Button>
          </div>
        )}

        {run.state === 'cancelled' && (
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex-1 rounded-[10px] bg-paper px-4 py-3 text-[15px] font-medium">Run stopped.</p>
            <Button variant="primary" onClick={onStart} disabled={blockReason !== null} busy={pending === 'start'}>
              Make a video
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
