import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ChannelCard } from '../components/ChannelCard';
import { Button, buttonClass } from '../components/Button';
import { useToast } from '../components/Toasts';
import { useRunStarter } from '../hooks/useRunStarter';
import { navigate } from '../hooks/useRoute';
import { useAppData } from '../state/appData';

export function StudioPage({ openNew }: { openNew: boolean }) {
  const { channels, overview, online, refresh } = useAppData();
  const toast = useToast();
  const { start, startingId, dialog } = useRunStarter();
  const [adding, setAdding] = useState(openNew);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (openNew) setAdding(true);
  }, [openNew]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const cancelAdd = () => {
    setAdding(false);
    setNewName('');
    if (openNew) navigate('#/');
  };

  const createChannel = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await api.createChannel(name);
      refresh();
      navigate(`#/channel/${created.id}`);
    } catch (err) {
      toast.failure(err);
    } finally {
      setCreating(false);
    }
  };

  const posted = overview?.counts.postedToday ?? 0;
  const running = overview?.counts.running ?? 0;

  return (
    <>
      <PageHeader title="Studio">
        <p>
          {posted} posted today
          {running > 0 ? `, ${running} making a video now` : ''}
        </p>
      </PageHeader>

      {online === false && (
        <div role="alert" className="mb-8 rounded-card border border-apple bg-apple-wash p-5 text-[15px] text-apple-deep">
          <p className="font-semibold">The app server isn't answering on this computer.</p>
          <p className="mt-1">
            Start it with <strong>npm run dev</strong> in the project folder.
          </p>
        </div>
      )}

      {channels === null ? (
        <p className="text-ink-soft">Loading channels...</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
          {channels.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              starting={startingId === ch.id}
              onMake={() => void start(ch)}
            />
          ))}

          <div className="rounded-card border border-dashed border-ink-soft/50 bg-sheet p-5">
            {adding ? (
              <form onSubmit={createChannel} className="flex h-full flex-col gap-3">
                <label htmlFor="new-channel-name" className="text-[15px] font-semibold">
                  Channel name
                </label>
                <input
                  id="new-channel-name"
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="For example, Mr. Apple"
                  className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
                />
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" busy={creating} disabled={newName.trim() === ''}>
                    Create channel
                  </Button>
                  <Button onClick={cancelAdd}>Cancel</Button>
                </div>
              </form>
            ) : (
              <div className="flex h-full flex-col items-start gap-3">
                <p className="text-[18px] font-bold">New channel</p>
                <p className="text-[14px] text-ink-soft">A channel is one character with its own logins and schedule.</p>
                <button type="button" onClick={() => setAdding(true)} className={buttonClass('secondary', 'md', 'mt-auto')}>
                  New channel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {channels !== null && channels.length === 0 && !adding && (
        <div className="mt-6">
          <EmptyState title="No channels yet.">Create the first channel to start making videos.</EmptyState>
        </div>
      )}

      {dialog}
    </>
  );
}
