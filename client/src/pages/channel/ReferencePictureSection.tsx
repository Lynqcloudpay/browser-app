import { useRef, useState, type ChangeEvent } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Button } from '../../components/Button';
import { Section } from '../../components/Section';

export function ReferencePictureSection({
  channelId,
  hasReference,
  onChanged,
}: {
  channelId: number;
  hasReference: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stamp, setStamp] = useState(() => Date.now());
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    setUploading(true);
    try {
      await api.uploadReferenceImage(channelId, file);
      setStamp(Date.now());
      setBroken(false);
      setMsg({ ok: true, text: 'Reference image updated.' });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Section
      title="Character reference picture"
      description="Grok uses this picture to keep the character looking the same in every video for this channel."
    >
      <div className="flex flex-wrap items-center gap-6">
        <div className="grid size-40 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-line bg-paper text-ink-soft">
          {hasReference && !broken ? (
            <img
              src={`/api/channels/${channelId}/reference-image?t=${stamp}`}
              alt="Current character reference"
              onError={() => setBroken(true)}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-[13px]">
              <ImageIcon className="size-8" aria-hidden="true" />
              No picture yet
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[14px]">Upload a clear JPEG, PNG or WebP of your character.</p>
          <input
            ref={inputRef}
            id="reference-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void onFile(e)}
            className="sr-only"
          />
          <Button busy={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? 'Uploading...' : 'Choose new picture'}
          </Button>
          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-[14px] text-leaf-ink' : 'text-[14px] text-apple-deep'}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}
