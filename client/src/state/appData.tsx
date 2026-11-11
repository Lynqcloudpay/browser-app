import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { usePolling } from '../hooks/usePolling';
import type { ChannelView, Health, Overview } from '../types';

export interface AppDataValue {
  health: Health | null;
  overview: Overview | null;
  channels: ChannelView[] | null;
  /** null until the first poll answers; false when health or overview fails. */
  online: boolean | null;
  refresh: () => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

/** Shared server state for the rail, Studio and the badges. Polls every 4 seconds. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [channels, setChannels] = useState<ChannelView[] | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  const refresh = usePolling(async (isActive) => {
    const [h, o, c] = await Promise.allSettled([api.health(), api.overview(), api.channels()]);
    if (!isActive()) return;
    if (h.status === 'fulfilled') setHealth(h.value);
    if (o.status === 'fulfilled') setOverview(o.value);
    if (c.status === 'fulfilled') setChannels(c.value.channels);
    setOnline(h.status === 'fulfilled' && o.status === 'fulfilled');
  }, 4000);

  const value = useMemo<AppDataValue>(
    () => ({ health, overview, channels, online, refresh }),
    [health, overview, channels, online, refresh],
  );
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider');
  return value;
}
