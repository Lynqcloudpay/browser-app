import { useCallback, useState } from 'react';
import { api } from '../api';
import { ProductionLine } from '../components/ProductionLine';
import { EmptyState } from '../components/EmptyState';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { useChannelData } from '../hooks/useChannelData';
import { useRunStarter } from '../hooks/useRunStarter';
import { isAccountBusy, isRunBusy } from '../labels';
import { useAppData } from '../state/appData';
import type { ChannelPatch } from '../types';
import { ChannelHeader } from './channel/ChannelHeader';
import { ChatGptSection } from './channel/ChatGptSection';
import { DangerSection } from './channel/DangerSection';
import { LoginsSection } from './channel/LoginsSection';
import { PostingSection } from './channel/PostingSection';
import { ReferencePictureSection } from './channel/ReferencePictureSection';
import { RecentRunsSection, RecentVideosSection } from './channel/RecentSections';
import { ScheduleSection } from './channel/ScheduleSection';

export function ChannelPage({ id }: { id: number }) {
  const data = useChannelData(id);
  const { channels } = useAppData();
  const toast = useToast();
  const { start, startingId, dialog: startDialog } = useRunStarter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pending, setPending] = useState<'stop' | 'skip' | null>(null);
  const { applyPatch, refresh, refreshLive } = data;

  const patch = useCallback(
    async (change: ChannelPatch) => {
      const updated = await api.patchChannel(id, change);
      applyPatch(updated);
      return updated;
    },
    [id, applyPatch],
  );

  const { channel, run, accounts, videos, runs, loadState, loadError } = data;

  if (!channel) {
    if (loadState === 'missing') {
      return (
        <EmptyState
          title="This channel doesn't exist."
          action={
            <a href="#/" className="rounded-[10px] border border-ink-soft bg-sheet px-4 py-2 text-[15px] font-semibold">
              Back to Studio
            </a>
          }
        />
      );
    }
    return loadError ? (
      <p role="alert" className="text-[15px] text-apple-deep">
        {loadError}
      </p>
    ) : (
      <p className="text-ink-soft">Loading channel...</p>
    );
  }

  const runBusy = isRunBusy(run);
  const accountBusy = isAccountBusy(accounts);
  const others = (channels ?? []).filter((c) => c.id !== id);

  const stop = async () => {
    const ok = await confirm({
      title: `Stop this run for ${channel.name}?`,
      body: 'If the video was already uploading it may still be posted.',
      confirmLabel: 'Stop run',
      tone: 'destructive',
    });
    if (!ok) return;
    setPending('stop');
    try {
      const result = await api.cancelRun(id);
      toast.success(result.message || 'Stopping the run.');
    } catch (err) {
      toast.failure(err);
    } finally {
      setPending(null);
      refresh();
    }
  };

  const skipLogin = async () => {
    setPending('skip');
    try {
      await api.skipLogin(id);
    } catch (err) {
      toast.failure(err);
    } finally {
      setPending(null);
      refreshLive();
    }
  };

  return (
    <>
      <ChannelHeader channel={channel} patch={patch} />

      <div className="mt-8">
        <ProductionLine
          channel={channel}
          run={run}
          accountBusy={accountBusy}
          pending={startingId === id ? 'start' : pending}
          onStart={() => void start(channel)}
          onStop={() => void stop()}
          onSkipLogin={() => void skipLogin()}
        />
      </div>

      <RecentVideosSection channelId={id} videos={videos} onChanged={refresh} />
      <RecentRunsSection runs={runs} />
      <ReferencePictureSection channelId={id} hasReference={channel.hasReferenceImage} onChanged={refresh} />
      <LoginsSection channel={channel} accounts={accounts} runBusy={runBusy} patch={patch} onChanged={refreshLive} />
      <ChatGptSection channel={channel} patch={patch} />
      <PostingSection channel={channel} patch={patch} />
      <ScheduleSection channel={channel} others={others} patch={patch} />
      <DangerSection channel={channel} />

      {loadError && (
        <p role="alert" className="mt-6 text-[14px] text-apple-deep">
          {loadError}
        </p>
      )}
      {startDialog}
      {confirmDialog}
    </>
  );
}
