import { Activity, Clapperboard, Film, Plus, Settings } from 'lucide-react';
import { navigate, type Route } from '../hooks/useRoute';
import { useAppData } from '../state/appData';
import type { ChannelView } from '../types';
import { cx } from '../cx';
import { AppleGlyph } from './AppleGlyph';
import { StatusDot, type DotTone } from './StatusDot';

const NAV = [
  { page: 'studio', href: '#/', label: 'Studio', icon: Clapperboard },
  { page: 'videos', href: '#/videos', label: 'Videos', icon: Film },
  { page: 'activity', href: '#/activity', label: 'Activity', icon: Activity },
  { page: 'settings', href: '#/settings', label: 'Settings', icon: Settings },
] as const;

function channelTone(ch: ChannelView): DotTone {
  if (ch.runStatus.state === 'running') return 'running';
  if (ch.runStatus.state === 'waiting_login' || ch.accounts.op.state === 'waiting_login') return 'waiting';
  if (ch.runStatus.state === 'error') return 'error';
  return 'idle';
}

const linkBase =
  'flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[15px] font-medium whitespace-nowrap hover:bg-paper';

/** Left rail on wide screens, top bar on narrow ones. */
export function Rail({ current, channelId }: { current: Route['page']; channelId: number | null }) {
  const { channels, overview, online, health } = useAppData();
  const toReview = overview?.counts.heldForReview ?? 0;

  const connection =
    online === null
      ? { tone: 'idle' as DotTone, text: 'Checking the connection' }
      : online
        ? { tone: 'in' as DotTone, text: 'Connected' }
        : { tone: 'error' as DotTone, text: "Can't reach the app server" };

  return (
    <aside className="border-b border-line bg-sheet min-[900px]:sticky min-[900px]:top-0 min-[900px]:flex min-[900px]:h-screen min-[900px]:flex-col min-[900px]:overflow-y-auto min-[900px]:border-r min-[900px]:border-b-0">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 min-[900px]:px-5 min-[900px]:pt-6">
        <a href="#/" className="flex items-center gap-2 rounded-md text-apple">
          <AppleGlyph />
          <span className="font-display text-[20px] font-bold leading-none text-ink">KindredStudio</span>
        </a>
        <span className="flex items-center gap-1.5 text-[13px] text-ink-soft min-[900px]:hidden">
          <StatusDot tone={connection.tone} />
          {connection.text}
        </span>
      </div>

      <nav aria-label="Main" className="mt-4 flex gap-1 overflow-x-auto px-3 pb-3 min-[900px]:flex-col min-[900px]:overflow-visible min-[900px]:px-3">
        {NAV.map(({ page, href, label, icon: Icon }) => {
          const active = current === page || (page === 'studio' && current === 'channel');
          return (
            <a
              key={page}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(linkBase, active ? 'bg-leaf-wash text-ink' : 'text-ink-soft hover:text-ink')}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
              {page === 'videos' && toReview > 0 && (
                <span className="ml-auto rounded-full bg-honey-wash px-2 py-0.5 text-[12px] font-semibold text-honey-ink">
                  {toReview} to review
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <nav aria-label="Channels" className="hidden min-[900px]:block min-[900px]:mt-6 min-[900px]:px-3">
        <p className="px-3 pb-2 text-[13px] font-semibold text-ink-soft">Channels</p>
        <ul className="space-y-0.5">
          {(channels ?? []).map((ch) => (
            <li key={ch.id}>
              <a
                href={`#/channel/${ch.id}`}
                aria-current={channelId === ch.id ? 'page' : undefined}
                className={cx(linkBase, 'w-full', channelId === ch.id ? 'bg-leaf-wash' : 'text-ink')}
              >
                <StatusDot tone={channelTone(ch)} />
                <span className="min-w-0 truncate">{ch.name}</span>
              </a>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => navigate('#/?new=1')}
              className={cx(linkBase, 'w-full text-ink-soft hover:text-ink')}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              New channel
            </button>
          </li>
        </ul>
      </nav>

      <div className="mt-auto hidden border-t border-line px-5 py-4 text-[13px] text-ink-soft min-[900px]:block">
        <p className="flex items-center gap-2 font-medium text-ink">
          <StatusDot tone={connection.tone} />
          {connection.text}
        </p>
        {health && <p className="mt-1">Version {health.version}</p>}
      </div>
    </aside>
  );
}
