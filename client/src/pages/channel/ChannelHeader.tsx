import { useState } from 'react';
import { ArrowLeft, Globe, Pencil } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toasts';
import type { ChannelPatch, ChannelUpdate, ChannelView } from '../../types';

export type PatchFn = (patch: ChannelPatch) => Promise<ChannelUpdate>;

export function ChannelHeader({ channel, patch }: { channel: ChannelView; patch: PatchFn }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);

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
    setOpening(true);
    try {
      await api.openBrowser(channel.id);
      toast.success('Browser window opened.');
    } catch (err) {
      toast.failure(err);
    } finally {
      setOpening(false);
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
      <Button busy={opening} onClick={() => void openBrowser()} icon={<Globe className="size-4" aria-hidden="true" />}>
        Open browser window
      </Button>
    </header>
  );
}
