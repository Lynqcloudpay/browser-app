import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../api';
import { isRunBusy } from '../labels';
import type { AccountsOverview, Channel, ChannelView, Run, RunStatus, Video } from '../types';
import { usePolling } from './usePolling';

const IDLE_RUN: RunStatus = { state: 'idle', step: '' };

export interface ChannelData {
  /** 'missing' when the server says the channel does not exist. */
  loadState: 'loading' | 'ready' | 'missing';
  loadError: string | null;
  channel: ChannelView | null;
  run: RunStatus;
  accounts: AccountsOverview | null;
  videos: Video[] | null;
  runs: Run[] | null;
  /** Merges a PATCH response into the channel without waiting for the next poll. */
  applyPatch: (updated: Channel) => void;
  /** Reloads the channel, videos and runs now. */
  refresh: () => void;
  /** Reloads run status and accounts now. */
  refreshLive: () => void;
}

/**
 * Everything the channel page shows. Run status and accounts poll every 2.5 s;
 * the channel, its videos and runs poll every 10 s and again when a run stops.
 */
export function useChannelData(id: number): ChannelData {
  const [loadState, setLoadState] = useState<ChannelData['loadState']>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channel, setChannelState] = useState<ChannelView | null>(null);
  const [run, setRun] = useState<RunStatus>(IDLE_RUN);
  const [accounts, setAccounts] = useState<AccountsOverview | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);

  const refreshLive = usePolling(
    async (isActive) => {
      try {
        const [rs, acc] = await Promise.all([api.runStatus(id), api.accounts(id)]);
        if (!isActive()) return;
        setRun(rs);
        setAccounts(acc);
      } catch {
        // The slow poll reports connection problems; keep the last known state here.
      }
    },
    2500,
    [id],
  );

  const refresh = usePolling(
    async (isActive) => {
      try {
        const [ch, vids, rr] = await Promise.all([
          api.channel(id),
          api.videos({ channel_id: id, limit: 6 }),
          api.runs({ channel_id: id, limit: 8 }),
        ]);
        if (!isActive()) return;
        setChannelState(ch);
        setRun(ch.runStatus);
        setAccounts(ch.accounts);
        setVideos(vids.videos);
        setRuns(rr.runs);
        setLoadState('ready');
        setLoadError(null);
      } catch (err) {
        if (!isActive()) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoadState('missing');
        } else {
          setLoadError(errorMessage(err));
        }
      }
    },
    10000,
    [id],
  );

  // A run that just stopped gets a fresh look at its channel, videos and runs.
  const busy = isRunBusy(run);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) refresh();
    wasBusy.current = busy;
  }, [busy, refresh]);

  const applyPatch = useCallback((updated: Channel) => {
    setChannelState((prev) => (prev ? { ...prev, ...updated } : prev));
  }, []);

  const refreshAll = useCallback(() => {
    refreshLive();
    refresh();
  }, [refreshLive, refresh]);

  return {
    loadState,
    loadError,
    channel,
    run,
    accounts,
    videos,
    runs,
    applyPatch,
    refresh: refreshAll,
    refreshLive,
  };
}
