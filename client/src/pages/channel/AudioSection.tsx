import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Section } from '../../components/Section';
import { useToast } from '../../components/Toasts';
import type { AudioFileInfo, ChannelView } from '../../types';
import type { PatchFn } from './ChannelHeader';

type Slot = 'song' | 'youtube-track';

const choiceClass = (on: boolean) =>
  on
    ? 'cursor-pointer rounded-[10px] bg-ink px-4 py-2.5 text-left font-semibold text-white'
    : 'cursor-pointer rounded-[10px] border border-ink-soft bg-sheet px-4 py-2.5 text-left font-semibold hover:bg-paper';

const inputClass = 'w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]';

function Choices<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={choiceClass(value === o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text box that saves when it loses focus (or Enter), not on every key. */
function SavedText({
  id,
  label,
  hint,
  value,
  placeholder,
  onSave,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() !== value) onSave(text.trim());
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={inputClass}
      />
      {hint && <p className="mt-1 text-[13px] text-ink-soft">{hint}</p>}
    </div>
  );
}

function AudioFile({
  channelId,
  slot,
  title,
  file,
  onChanged,
}: {
  channelId: number;
  slot: Slot;
  title: string;
  file: AudioFileInfo | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      await api.uploadAudio(channelId, slot, f);
      onChanged();
    } catch (err) {
      toast.failure(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteAudio(channelId, slot);
      onChanged();
    } catch (err) {
      toast.failure(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-[10px] border border-line p-3">
      <p className="text-[14px] font-semibold">{title}</p>
      {file ? (
        <>
          <p className="text-[13px] text-ink-soft">
            {file.name} · {(file.bytes / 1024 / 1024).toFixed(1)} MB
          </p>
          <audio controls preload="none" className="w-full" src={`/api/channels/${channelId}/audio/${slot}?v=${file.bytes}`} />
        </>
      ) : (
        <p className="text-[13px] text-ink-soft">No file attached yet. MP3, M4A, WAV or AAC.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.aac"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="cursor-pointer rounded-[10px] bg-ink px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {file ? 'Replace file' : 'Attach file'}
        </button>
        {file && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="cursor-pointer rounded-[10px] border border-ink-soft bg-sheet px-4 py-2 font-semibold hover:bg-paper disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function AudioSection({
  channel,
  patch,
  onChanged,
}: {
  channel: ChannelView;
  patch: PatchFn;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const save = async (change: Parameters<PatchFn>[0]) => {
    setSaving(true);
    try {
      await patch(change);
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const songNeeded =
    (channel.post_tiktok && channel.tiktok_audio === 'my_song') || (channel.post_youtube && channel.youtube_audio === 'my_song');
  const mixing = songNeeded || (channel.post_youtube && channel.youtube_audio === 'youtube_library') ||
    (channel.post_tiktok && channel.tiktok_audio === 'tiktok_sound');

  return (
    <Section
      title="Sound"
      description="Keep Grok's own sound, or mute it and put music under the video. Set it for each platform."
    >
      {mixing && !channel.audioToolsReady && (
        <p role="alert" className="rounded-[10px] bg-honey-wash p-3 text-[14px] text-honey-ink">
          ffmpeg is not installed, so the sound cannot be changed. In Terminal run: brew install ffmpeg
        </p>
      )}

      <AudioFile channelId={channel.id} slot="song" title="Your song" file={channel.songFile} onChanged={onChanged} />
      {songNeeded && !channel.songFile && (
        <p className="text-[14px] font-medium text-honey-ink">Attach your song, or videos set to "My song" will not post.</p>
      )}

      {channel.post_tiktok && (
        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="mb-2 text-[14px] font-semibold">TikTok</legend>
          <Choices
            label="TikTok sound"
            value={channel.tiktok_audio}
            disabled={saving}
            onChange={(v) => void save({ tiktok_audio: v })}
            options={[
              { key: 'original', label: "Grok's sound" },
              { key: 'my_song', label: 'My song' },
              { key: 'tiktok_sound', label: 'TikTok library' },
            ]}
          />
          {channel.tiktok_audio === 'tiktok_sound' && (
            <SavedText
              id="tiktok-sound"
              label="TikTok sound to use"
              placeholder="Chicken Banana - Crazy Music Channel"
              hint={
                'The video is muted and this sound is picked from TikTok\'s library, with its credit. Add " - artist" to pick the exact one. ' +
                'If TikTok cannot find it, the video is not posted to TikTok.'
              }
              value={channel.tiktok_sound}
              onSave={(v) => void save({ tiktok_sound: v })}
            />
          )}
        </fieldset>
      )}

      {channel.post_youtube && (
        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="mb-2 text-[14px] font-semibold">YouTube</legend>
          <Choices
            label="YouTube sound"
            value={channel.youtube_audio}
            disabled={saving}
            onChange={(v) => void save({ youtube_audio: v })}
            options={[
              { key: 'original', label: "Grok's sound" },
              { key: 'my_song', label: 'My song' },
              { key: 'youtube_library', label: 'YouTube Audio Library' },
            ]}
          />
          {channel.youtube_audio === 'youtube_library' && (
            <>
              <p className="text-[13px] text-ink-soft">
                Download a free track in YouTube Studio → Audio Library, attach it here, and it is put under every YouTube video.
              </p>
              <AudioFile
                channelId={channel.id}
                slot="youtube-track"
                title="YouTube Audio Library track"
                file={channel.youtubeTrackFile}
                onChanged={onChanged}
              />
              <SavedText
                id="youtube-credit"
                label="Credit line (added to the description)"
                placeholder="Music: Track name by Artist (YouTube Audio Library)"
                hint="Some library tracks ask for this credit. Leave empty if yours does not."
                value={channel.youtube_track}
                onSave={(v) => void save({ youtube_track: v })}
              />
              {!channel.youtubeTrackFile && (
                <p className="text-[14px] font-medium text-honey-ink">Attach the track, or YouTube videos will not post.</p>
              )}
            </>
          )}
        </fieldset>
      )}
    </Section>
  );
}
