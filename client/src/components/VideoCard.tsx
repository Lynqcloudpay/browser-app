import { useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Clock, ExternalLink, Film, Play, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { absolute, duration, relativeTime } from '../format';
import { cx } from '../cx';
import { VIDEO_STATE_LABEL } from '../labels';
import type { VideoBusy, VideoActions } from '../hooks/useVideoActions';
import type { Video, VideoState } from '../types';
import { Button, buttonClass } from './Button';

const BADGE: Record<VideoState, { icon: LucideIcon; tone: string }> = {
  rendering: { icon: Clock, tone: 'bg-paper text-ink-soft' },
  ready_to_publish: { icon: Send, tone: 'bg-paper text-ink' },
  scheduled: { icon: AlertTriangle, tone: 'bg-honey-wash text-honey-ink' },
  published: { icon: CheckCircle2, tone: 'bg-leaf-wash text-leaf-ink' },
  held_for_review: { icon: AlertTriangle, tone: 'bg-honey-wash text-honey-ink' },
  rejected: { icon: Ban, tone: 'bg-paper text-ink-soft' },
  failed: { icon: AlertTriangle, tone: 'bg-apple-wash text-apple-deep' },
};

interface VideoCardProps {
  video: Video;
  showChannel: boolean;
  busy: VideoBusy | null;
  actions: VideoActions;
}

export function VideoCard({ video, showChannel, busy, actions }: VideoCardProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = busy && busy.id === video.id ? busy.action : null;
  const title = video.title?.trim() || video.hook?.trim() || 'Untitled video';
  const badge = BADGE[video.state];
  const BadgeIcon = badge.icon;
  const canPost =
    video.file_exists && (video.state === 'ready_to_publish' || video.state === 'failed' || video.state === 'scheduled');
  const length = duration(video.duration_seconds);
  const meta = [showChannel ? video.channel_name : null, relativeTime(video.created_at), length || null]
    .filter(Boolean)
    .join(', ');

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(video.prompt ?? '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-sheet">
      <div className="relative aspect-[9/16] w-full bg-paper">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-ink-soft">
            <Film className="size-8" aria-hidden="true" />
          </div>
        )}
        {video.file_exists && video.video_url ? (
          <button
            type="button"
            onClick={() => actions.play(video)}
            aria-label={`Play ${title}`}
            className="absolute inset-0 grid place-items-center bg-ink/0 transition-colors hover:bg-ink/10"
          >
            <span className="grid size-12 place-items-center rounded-full bg-sheet text-ink shadow-[0_4px_14px_rgba(22,48,43,0.25)]">
              <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
            </span>
          </button>
        ) : (
          <span className="absolute bottom-2 left-2 rounded-full bg-sheet px-2.5 py-1 text-[12px] font-semibold">File removed</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="text-[15px] leading-snug font-semibold">{title}</h3>
        <p className="text-[13px] text-ink-soft" title={absolute(video.created_at)}>
          {meta}
        </p>
        <p className={cx('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', badge.tone)}>
          <BadgeIcon className="size-3.5" aria-hidden="true" />
          {VIDEO_STATE_LABEL[video.state]}
        </p>

        {video.state === 'held_for_review' && (
          <div className="rounded-[10px] bg-honey-wash p-3 text-[13px] text-honey-ink">
            <p>The safety check found words that need a person to look. Watch the video, then approve or discard.</p>
            {video.hold_reason && <p className="mt-1.5 font-semibold">{video.hold_reason}</p>}
            {video.qa && video.qa.flags.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {video.qa.flags.map((f, i) => (
                  <li key={i}>
                    {f.issue}
                    {f.severity === 'critical' ? ' (critical)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(video.tiktok_url || video.youtube_url) && (
          <div className="flex flex-wrap gap-3 text-[13px] font-semibold">
            {video.tiktok_url && (
              <a href={video.tiktok_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md underline underline-offset-4">
                TikTok <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
            {video.youtube_url && (
              <a href={video.youtube_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md underline underline-offset-4">
                YouTube <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {video.state === 'held_for_review' && (
            <>
              <Button size="sm" variant="primary" busy={mine === 'approve'} onClick={() => actions.approve(video)}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" busy={mine === 'discard'} onClick={() => actions.discard(video)}>
                Discard
              </Button>
            </>
          )}
          {canPost && (
            <Button size="sm" variant="primary" busy={mine === 'publish'} onClick={() => actions.publish(video)}>
              {video.state === 'scheduled' ? 'Post again' : 'Post now'}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[13px]">
          {video.prompt && (
            <button type="button" onClick={() => setPromptOpen((v) => !v)} aria-expanded={promptOpen} className={buttonClass('ghost', 'sm', 'px-0')}>
              {promptOpen ? 'Hide prompt' : 'Show prompt'}
            </button>
          )}
          {video.file_exists && (
            <button
              type="button"
              disabled={mine !== null}
              onClick={() => actions.deleteFile(video)}
              className={buttonClass('ghost', 'sm', 'px-0 text-apple-deep')}
            >
              Delete file
            </button>
          )}
          <button
            type="button"
            disabled={mine !== null}
            onClick={() => actions.deleteRecord(video)}
            className={buttonClass('ghost', 'sm', 'px-0 text-apple-deep')}
          >
            Delete video and record
          </button>
        </div>

        {promptOpen && video.prompt && (
          <div className="rounded-[10px] bg-paper p-3">
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{video.prompt}</p>
            <div className="mt-2 flex items-center gap-3">
              <Button size="sm" onClick={copyPrompt}>
                {copied ? 'Copied' : 'Copy prompt'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
