import { useState } from 'react';
import { ArrowLeft, Globe, Pencil } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { StatusDot } from '../../components/StatusDot';
import { useToast } from '../../components/Toasts';
import type { ChannelPatch, ChannelUpdate, ChannelView } from '../../types';

export type PatchFn = (patch: ChannelPatch) => Promise<ChannelUpdate>;

export function ChannelHeader({
  channel,
  patch,
  runBusy,
  accountBusy,
  onChanged,
}: {
  channel: ChannelView;
  patch: PatchFn;
  /** A run is making or posting a video, so the browser is in use. */
  runBusy: boolean;
  /** A login check or account switch is using the browser. */
  accountBusy: boolean;
  /** Reloads the channel data the page polls. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const [saving, setSaving] = useState(false);
  const [browserPending, setBrowserPending] = useState<'open' | 'close' | null>(null);

  const browserInUse = runBusy || accountBusy;
  const closeBlockedReason = runBusy
    ? 'A video is being made, so the browser is in use.'
    : accountBusy
      ? 'A login check is using the browser.'
      : null;

  const save = async () => {
    const clean = name.trim();
    if (!clean || clean === channel.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await patch({ name: clean });
      setEditing(false);
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const openBrowser = async () => {
    setBrowserPending('open');
    try {
      await api.openBrowser(channel.id);
      toast.success('Browser window opened.');
    } catch (err) {
      toast.failure(err);
    } finally {
      setBrowserPending(null);
      onChanged();
    }
  };

  const closeBrowser = async () => {
    const ok = await confirm({
      title: 'Close the browser window?',
      body: 'Logins stay saved. The next video opens it again, which takes about a minute longer.',
      confirmLabel: 'Close browser',
    });
    if (!ok) return;
    setBrowserPending('close');
    try {
      const result = await api.closeBrowser(channel.id);
      toast.success(result.message || 'Browser window closed.');
    } catch (err) {
      toast.failure(err);
    } finally {
      setBrowserPending(null);
      onChanged();
    }
  };

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <a href="#/" className="inline-flex items-center gap-1.5 rounded-md text-[14px] font-semibold text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Studio
        </a>
        {editing ? (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label htmlFor="channel-name" className="text-[14px] font-semibold">
              Channel name
            </label>
            <input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="min-w-0 rounded-[10px] border border-ink-soft bg-sheet px-3 py-1.5 font-display text-[24px] font-bold"
            />
            <Button type="submit" variant="primary" busy={saving}>
              Save name
            </Button>
            <Button
              onClick={() => {
                setName(channel.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-bold leading-[1.15]">{channel.name}</h1>
            <Button
              size="sm"
              icon={<Pencil className="size-3.5" aria-hidden="true" />}
              onClick={() => {
                setName(channel.name);
                setEditing(true);
              }}
            >
              Rename
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink-soft">
            <StatusDot tone={channel.browserOpen ? 'in' : 'idle'} />
            {channel.browserOpen ? 'Browser open' : 'Browser closed'}
          </p>
          {channel.browserOpen ? (
            <Button
              busy={browserPending === 'close'}
              disabled={browserInUse || browserPending !== null}
              onClick={() => void closeBrowser()}
              icon={<Globe className="size-4" aria-hidden="true" />}
            >
              Close browser
            </Button>
          ) : (
            <Button
              busy={browserPending === 'open'}
              disabled={browserPending !== null}
              onClick={() => void openBrowser()}
              icon={<Globe className="size-4" aria-hidden="true" />}
            >
              Open browser
            </Button>
          )}
        </div>
        {channel.browserOpen && closeBlockedReason && (
          <p className="text-[13px] text-honey-ink">Can't close yet. {closeBlockedReason}</p>
        )}
      </div>
      {dialog}
    </header>
  );
}
