import { ToastProvider } from './components/Toasts';
import { Rail } from './components/Rail';
import { AppDataProvider } from './state/appData';
import { useRoute } from './hooks/useRoute';
import { StudioPage } from './pages/StudioPage';
import { ChannelPage } from './pages/ChannelPage';
import { VideosPage } from './pages/VideosPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <ToastProvider>
      <AppDataProvider>
        <Shell />
      </AppDataProvider>
    </ToastProvider>
  );
}

function Shell() {
  const route = useRoute();

  return (
    <div className="min-h-screen min-[900px]:grid min-[900px]:grid-cols-[232px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-[10px] focus:bg-sheet focus:px-4 focus:py-2 focus:font-semibold"
      >
        Skip to content
      </a>
      <Rail current={route.page} channelId={route.page === 'channel' ? route.id : null} />
      <main id="main" tabIndex={-1} className="w-full max-w-[1080px] px-4 pt-6 pb-16 focus:outline-none min-[900px]:px-10 min-[900px]:pt-10">
        {route.page === 'studio' && <StudioPage openNew={route.openNew} />}
        {route.page === 'channel' && <ChannelPage key={route.id} id={route.id} />}
        {route.page === 'videos' && <VideosPage channel={route.channel} />}
        {route.page === 'activity' && <ActivityPage />}
        {route.page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
