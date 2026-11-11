import { useState } from 'react';
import { Section } from '../../components/Section';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toasts';
import type { ChannelView } from '../../types';
import type { PatchFn } from './ChannelHeader';

export function PostingSection({ channel, patch }: { channel: ChannelView; patch: PatchFn }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const save = async (change: Partial<Pick<ChannelView, 'post_tiktok' | 'post_youtube' | 'youtube_made_for_kids'>>) => {
    setSaving(true);
    try {
      await patch(change);
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const nothingOn = !channel.post_tiktok && !channel.post_youtube;

  return (
    <Section title="Where to post" description="Each finished video goes to the platforms turned on here, from the accounts signed in for this channel.">
      <Switch checked={channel.post_tiktok} disabled={saving} onChange={(v) => void save({ post_tiktok: v })}>
        <span className="block font-semibold">TikTok Studio</span>
        <span className="block text-[14px] text-ink-soft">Posts to the TikTok account signed in for this channel.</span>
      </Switch>
      <Switch checked={channel.post_youtube} disabled={saving} onChange={(v) => void save({ post_youtube: v })}>
        <span className="block font-semibold">YouTube Shorts</span>
        <span className="block text-[14px] text-ink-soft">Posts publicly to the YouTube channel signed in for this channel.</span>
      </Switch>
      {channel.post_youtube && (
        <div className="border-t border-line pt-4">
          <Switch checked={channel.youtube_made_for_kids} disabled={saving} onChange={(v) => void save({ youtube_made_for_kids: v })}>
            <span className="block font-semibold">YouTube made for kids</span>
            <span className="block text-[14px] text-ink-soft">Sets the required children's content flag on YouTube.</span>
          </Switch>
        </div>
      )}
      {nothingOn && <p className="text-[14px] font-medium text-honey-ink">Turn on at least one platform to make videos.</p>}
    </Section>
  );
}
