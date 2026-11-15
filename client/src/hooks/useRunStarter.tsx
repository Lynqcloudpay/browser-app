import { useState } from 'react';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { platformsText } from '../labels';
import { useAppData } from '../state/appData';
import type { Channel } from '../types';

/** Confirmed "make and post a video" for a channel. Render `dialog` in the page. */
export function useRunStarter() {
  const toast = useToast();
  const { refresh } = useAppData();
  const { confirm, dialog } = useConfirm();
  const [startingId, setStartingId] = useState<number | null>(null);

  const start = async (ch: Channel, opts: { noPost?: boolean } = {}): Promise<void> => {
    if (startingId !== null) return;
    const platforms = platformsText(ch);
    const length = ch.long_video ? 'a 1-minute video (4 Grok scenes, joined)' : 'the video';
    if (opts.noPost) {
      const ok = await confirm({
        title: `Make a video for ${ch.name} without posting?`,
        body: `It writes a new prompt in ChatGPT, makes ${length} in Grok and runs the safety check. Nothing is posted: the video waits on the Videos page for "Post now". It uses Grok credits.`,
        confirmLabel: 'Make it, don\'t post',
      });
      if (!ok) return;
      setStartingId(ch.id);
      try {
        await api.startRun(ch.id, { targetDurationSec: ch.grok_duration, targetResolution: ch.grok_resolution, noPost: true });
        toast.success(`Started a video for ${ch.name} (not posting).`);
      } catch (err) {
        toast.failure(err);
      } finally {
        setStartingId(null);
        refresh();
      }
      return;
    }
    if (!platforms) {
      toast.error('Turn on at least one platform (TikTok, YouTube Shorts, Instagram Reels, or Facebook Reels) before making a video.');
      return;
    }
    const ok = await confirm({
      title: `Make and post a video for ${ch.name}?`,
      body: `It writes a new prompt in ChatGPT, makes ${length} in Grok, runs the safety check, then posts it publicly to ${platforms}.`,
      confirmLabel: 'Make and post a video',
    });
    if (!ok) return;
    setStartingId(ch.id);
    try {
      await api.startRun(ch.id, { targetDurationSec: ch.grok_duration, targetResolution: ch.grok_resolution });
      toast.success(`Started a video for ${ch.name}.`);
    } catch (err) {
      toast.failure(err);
    } finally {
      setStartingId(null);
      refresh();
    }
  };

  return { start, startingId, dialog };
}
