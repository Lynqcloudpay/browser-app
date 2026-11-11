import type { ReactNode } from 'react';
import { ImageIcon } from 'lucide-react';
import { clock, relativeTime } from '../format';
import { LOGIN_SITES, RUN_STATE_LABEL, isAccountBusy, isRunBusy, platformsText, stageLabel } from '../labels';
import { cx } from '../cx';
import type { ChannelView } from '../types';
import { Button, buttonClass } from './Button';
import { StatusDot, type DotTone } from './StatusDot';
import { AppleGlyph } from './AppleGlyph';

const loginTone = (state: 'in' | 'out' | 'unknown' | undefined): DotTone =>
  state === 'in' ? 'in' : state === 'out' ? 'out' : 'unknown';
const loginWord = (state: 'in' | 'out' | 'unknown' | undefined): string =>
  state === 'in' ? 'signed in' : state === 'out' ? 'signed out' : 'not checked';

function scheduleLine(ch: ChannelView): string {
  if (!ch.schedule_enabled) return 'No schedule';
  const times = ch.schedule_times.join(', ');
  return ch.nextRunAt ? `Daily at ${times}. Next ${clock(ch.nextRunAt)}` : `Daily at ${times}`;
}

function lastRunLine(ch: ChannelView): ReactNode {
  const r = ch.lastRun;
  if (!r) return ch.stats.totalVideos > 0 ? 'No runs recorded since the update. Earlier videos are in Videos.' : 'No videos made yet.';
  const when = relativeTime(r.finished_at ?? r.started_at);
  if (r.state === 'error') {
    return (
      <span className="text-apple-deep">
        Last run failed {when}: {r.message}
      </span>
    );
  }
  if (r.state === 'done') return `Posted ${when}`;
  if (r.state === 'cancelled') return `Last run stopped ${when}`;
  return `Last run ${RUN_STATE_LABEL[r.state].toLowerCase()} ${when}`;
}

function setupItems(ch: ChannelView): string[] {
  const items: string[] = [];
  if (!ch.hasReferenceImage) items.push('Add a reference picture');
  if (!ch.chatgpt_chat_url) items.push('Link the ChatGPT chat');
  if (ch.accounts.sites.some((s) => s.state !== 'in')) items.push('Check logins');
  return items;
}

interface ChannelCardProps {
  channel: ChannelView;
  starting: boolean;
  onMake: () => void;
}

export function ChannelCard({ channel: ch, starting, onMake }: ChannelCardProps) {
  const running = isRunBusy(ch.runStatus);
  const platforms = platformsText(ch);
  const blocked = !platforms
    ? 'Turn on a platform on the channel page first.'
    : isAccountBusy(ch.accounts)
      ? 'A login check is in progress.'
      : running
        ? 'A video is already being made.'
        : null;
  const setup = setupItems(ch);
  const chatHref = `#/channel/${ch.id}`;

  return (
    <article aria-labelledby={`card-${ch.id}`} className="flex flex-col gap-4 rounded-card border border-line bg-sheet p-5">
      <div className="flex gap-4">
        <div className="grid size-[88px] shrink-0 place-items-center overflow-hidden rounded-[10px] border border-line bg-paper text-ink-soft">
          {ch.hasReferenceImage ? (
            <img
              src={`/api/channels/${ch.id}/reference-image?v=${encodeURIComponent(ch.updated_at)}`}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <AppleGlyph className="size-9 text-apple" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={`card-${ch.id}`} className="truncate text-[18px] font-bold">
            {ch.name}
          </h3>
          <p className="mt-1 text-[14px] text-ink-soft">
            Posts to: {platforms || 'nowhere yet'}
          </p>
          <p className="mt-0.5 text-[14px] text-ink-soft">{scheduleLine(ch)}</p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Logins">
        {LOGIN_SITES.map((site) => {
          const state = ch.accounts.sites.find((s) => s.key === site.key)?.state;
          const word = loginWord(state);
          return (
            <li key={site.key} className="flex items-center gap-1.5 text-[13px]" title={`${site.label}: ${word}`} aria-label={`${site.label}: ${word}`}>
              <StatusDot tone={loginTone(state)} />
              <span>{site.label}</span>
            </li>
          );
        })}
      </ul>

      <dl className="flex gap-6 text-[13px]">
        <div>
          <dt className="text-ink-soft">Posted today</dt>
          <dd className="text-[18px] font-bold">{ch.stats.postedToday}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">All videos</dt>
          <dd className="text-[18px] font-bold">{ch.stats.totalVideos}</dd>
        </div>
      </dl>

      <div className="min-h-[44px] text-[14px]">
        {running ? (
          <p className="flex items-start gap-2 font-medium">
            <StatusDot tone="running" className="mt-1.5" />
            <span className="line-clamp-2 min-w-0">
              {stageLabel(ch.runStatus.stage) ? `${stageLabel(ch.runStatus.stage)}: ` : ''}
              {ch.runStatus.step}
            </span>
          </p>
        ) : (
          <p className="text-ink-soft">{lastRunLine(ch)}</p>
        )}
      </div>

      {setup.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Setup to do">
          {setup.map((item) => (
            <li key={item}>
              <a href={chatHref} className={cx(buttonClass('secondary', 'sm'), 'bg-honey-wash text-honey-ink')}>
                <ImageIcon className="size-3.5" aria-hidden="true" />
                {item}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button variant="primary" busy={starting} disabled={blocked !== null} onClick={onMake}>
          Make a video
        </Button>
        <a href={chatHref} className={buttonClass('secondary')}>
          Open
          <span className="sr-only"> {ch.name}</span>
        </a>
        {blocked && <p className="w-full text-[13px] text-honey-ink">{blocked}</p>}
      </div>
    </article>
  );
}
