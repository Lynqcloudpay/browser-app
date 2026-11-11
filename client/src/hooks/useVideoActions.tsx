import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { VideoPlayerModal } from '../components/VideoPlayerModal';
import type { Video } from '../types';
import { navigate } from './useRoute';

export type VideoBusyAction = 'approve' | 'discard' | 'publish' | 'delete';

export interface VideoBusy {
  id: string;
  action: VideoBusyAction;
}

export interface VideoActions {
  approve: (v: Video) => void;
  discard: (v: Video) => void;
  publish: (v: Video) => void;
  play: (v: Video) => void;
  deleteFile: (v: Video) => void;
  deleteRecord: (v: Video) => void;
}

export interface VideoActionsResult {
  actions: VideoActions;
  busy: VideoBusy | null;
  /** Confirm dialog and player. Render once in the page. */
  modals: ReactNode;
}

const titleOf = (v: Video) => v.title?.trim() || v.hook?.trim() || 'this video';

/** Approve, discard, post, play and delete for one video, with confirmations and toasts. */
export function useVideoActions(onChanged: () => void): VideoActionsResult {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<VideoBusy | null>(null);
  const [player, setPlayer] = useState<{ url: string; title: string } | null>(null);

  const perform = async (video: Video, action: VideoBusyAction, task: () => Promise<unknown>, done: string) => {
    setBusy({ id: video.id, action });
    try {
      await task();
      toast.success(done);
    } catch (err) {
      toast.failure(err);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const actions: VideoActions = {
    approve: (v) => {
      void perform(v, 'approve', () => api.approveVideo(v.id), 'Approved. The video is ready to post.');
    },
    discard: (v) => {
      void (async () => {
        const ok = await confirm({
          title: 'Discard this video?',
          body: `"${titleOf(v)}" will be marked discarded and will not be posted.`,
          confirmLabel: 'Discard video',
          tone: 'destructive',
        });
        if (ok) await perform(v, 'discard', () => api.rejectVideo(v.id), 'Discarded. It will not be posted.');
      })();
    },
    publish: (v) => {
      void (async () => {
        const again = v.state === 'scheduled';
        const ok = await confirm({
          title: again ? `Post "${titleOf(v)}" again?` : `Post "${titleOf(v)}" now?`,
          body: again
            ? `TikTok or YouTube did not confirm the first attempt. Check the ${v.channel_name} account first so it is not posted twice.`
            : `This posts "${titleOf(v)}" publicly to the platforms turned on for ${v.channel_name} that have not confirmed it yet.`,
          confirmLabel: again ? 'Post again' : 'Post now',
        });
        if (!ok) return;
        setBusy({ id: v.id, action: 'publish' });
        try {
          await api.publishVideo(v.id);
          toast.success(`Posting started for ${v.channel_name}. Watch progress on the channel page.`);
          navigate(`#/channel/${v.channel_id}`);
        } catch (err) {
          toast.failure(err);
        } finally {
          setBusy(null);
          onChanged();
        }
      })();
    },
    play: (v) => {
      if (v.video_url) setPlayer({ url: v.video_url, title: titleOf(v) });
    },
    deleteFile: (v) => {
      void (async () => {
        const ok = await confirm({
          title: 'Delete the video file?',
          body: 'The video file and its cover image are deleted from this computer. The record stays in the list, without a file.',
          confirmLabel: 'Delete file',
          tone: 'destructive',
        });
        if (ok) await perform(v, 'delete', () => api.deleteVideo(v.id, false), 'Video file deleted.');
      })();
    },
    deleteRecord: (v) => {
      void (async () => {
        const ok = await confirm({
          title: 'Delete the video and its record?',
          body: 'The video file, its cover image and the record of it are deleted. This cannot be undone.',
          confirmLabel: 'Delete video and record',
          tone: 'destructive',
        });
        if (ok) await perform(v, 'delete', () => api.deleteVideo(v.id, true), 'Video and record deleted.');
      })();
    },
  };

  const modals = (
    <>
      {dialog}
      {player && <VideoPlayerModal url={player.url} title={player.title} onClose={() => setPlayer(null)} />}
    </>
  );

  return { actions, busy, modals };
}
