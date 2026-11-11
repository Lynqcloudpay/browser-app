import { useState } from 'react';
import { api, errorMessage } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { VideoCard } from '../components/VideoCard';
import { cx } from '../cx';
import { navigate } from '../hooks/useRoute';
import { useVideoActions } from '../hooks/useVideoActions';
import { usePolling } from '../hooks/usePolling';
import { useAppData } from '../state/appData';
import type { Video, VideoState } from '../types';

type Filter = 'all' | 'published' | 'review' | 'pending' | 'failed';

const FILTERS: { key: Filter; label: string; states: VideoState[] | null }[] = [
  { key: 'all', label: 'All', states: null },
  { key: 'published', label: 'Posted', states: ['published'] },
  { key: 'review', label: 'Needs review', states: ['held_for_review'] },
  { key: 'pending', label: 'Not posted', states: ['ready_to_publish', 'scheduled', 'rendering'] },
  { key: 'failed', label: 'Failed', states: ['failed', 'rejected'] },
];

export function VideosPage({ channel }: { channel: number | null }) {
  const { channels } = useAppData();
  const [filter, setFilter] = useState<Filter>('all');
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = usePolling(
    async (isActive) => {
      try {
        const res = await api.videos({ channel_id: channel ?? undefined, limit: 200 });
        if (!isActive()) return;
        setVideos(res.videos);
        setLoadError(null);
      } catch (err) {
        if (isActive()) setLoadError(errorMessage(err));
      }
    },
    15000,
    [channel],
  );

  const { actions, busy, modals } = useVideoActions(reload);

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const shown = (videos ?? []).filter((v) => !active.states || active.states.includes(v.state));

  return (
    <>
      <PageHeader title="Videos">
        <span>Every video the studio has made, with its state.</span>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div>
          <label htmlFor="video-channel" className="mb-1.5 block text-[13px] font-semibold text-ink-soft">
            Channel
          </label>
          <select
            id="video-channel"
            value={channel ?? ''}
            onChange={(e) => navigate(e.target.value ? `#/videos?channel=${e.target.value}` : '#/videos')}
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

        <div>
          <p id="video-filter-label" className="mb-1.5 text-[13px] font-semibold text-ink-soft">
            Show
          </p>
          <div role="group" aria-labelledby="video-filter-label" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cx(
                  'min-h-9 rounded-[10px] border px-3 text-[14px] font-semibold',
                  filter === f.key ? 'border-ink bg-ink text-white' : 'border-ink-soft bg-sheet text-ink hover:bg-paper',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="mb-5 text-[14px] text-apple-deep">
          {loadError}
        </p>
      )}

      {videos === null ? (
        <p className="text-ink-soft">Loading videos...</p>
      ) : shown.length === 0 ? (
        videos.length === 0 ? (
          <EmptyState
            title="No videos yet."
            action={
              <a href="#/" className="rounded-[10px] border border-ink-soft bg-sheet px-4 py-2 text-[15px] font-semibold">
                Open Studio
              </a>
            }
          >
            Open a channel and make the first one.
          </EmptyState>
        ) : (
          <p className="text-ink-soft">No videos match this filter.</p>
        )
      ) : (
        <>
          <p className="mb-4 text-[14px] text-ink-soft">
            {shown.length} {shown.length === 1 ? 'video' : 'videos'}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-4">
            {shown.map((v) => (
              <VideoCard key={v.id} video={v} showChannel busy={busy} actions={actions} />
            ))}
          </div>
        </>
      )}

      {modals}
    </>
  );
}
