import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { api, errorMessage } from '../api';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { Section } from '../components/Section';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { megabytes } from '../format';
import { useAppData } from '../state/appData';
import type { StorageStatus, SystemCheck } from '../types';

const SEGMENTS: { key: 'videos' | 'frames' | 'thumbnails' | 'profiles'; label: string; color: string; note?: string }[] = [
  { key: 'videos', label: 'Videos', color: 'bg-apple' },
  { key: 'frames', label: 'Cover frames and debug screenshots', color: 'bg-honey' },
  { key: 'thumbnails', label: 'Thumbnails', color: 'bg-leaf' },
  { key: 'profiles', label: 'Browser profiles', color: 'bg-ink-soft', note: 'Holds your saved logins. Not removable here.' },
];

function StorageBar({ storage }: { storage: StorageStatus }) {
  const total = SEGMENTS.reduce((sum, s) => sum + storage[s.key].sizeMb, 0);
  const summary = SEGMENTS.map((s) => `${s.label} ${megabytes(storage[s.key].sizeMb)}`).join(', ');
  return (
    <div>
      <div
        role="img"
        aria-label={total > 0 ? `Storage use: ${summary}` : 'Nothing stored yet'}
        className="flex h-4 w-full overflow-hidden rounded-full bg-line"
      >
        {total > 0 &&
          SEGMENTS.map((s) => (
            <div
              key={s.key}
              className={s.color}
              style={{ width: `${(storage[s.key].sizeMb / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-x-3 text-[14px]">
            <span className={`mt-1 inline-block size-3 shrink-0 rounded-sm ${s.color}`} aria-hidden="true" />
            <span className="font-semibold">{s.label}</span>
            <span className="text-ink-soft">
              {megabytes(storage[s.key].sizeMb)}, {s.key === 'profiles' ? `${storage[s.key].count} ${storage[s.key].count === 1 ? 'profile' : 'profiles'}` : `${storage[s.key].count} ${storage[s.key].count === 1 ? 'file' : 'files'}`}
            </span>
            {s.note && <span className="w-full pl-6 text-[13px] text-ink-soft">{s.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsPage() {
  const { health } = useAppData();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [check, setCheck] = useState<SystemCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await api.systemCheck());
      setCheckError(null);
    } catch (err) {
      setCheckError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const loadStorage = async () => {
    try {
      setStorage(await api.storageStatus());
      setStorageError(null);
    } catch (err) {
      setStorageError(errorMessage(err));
    }
  };

  useEffect(() => {
    void runCheck();
    void loadStorage();
    // Loaded once when the page opens; the buttons below reload on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFolder = async (target: 'videos' | 'logs') => {
    setBusy(`open-${target}`);
    try {
      await api.openFolder(target);
    } catch (err) {
      toast.failure(err);
    } finally {
      setBusy(null);
    }
  };

  const cleanup = async (kind: 'frames' | 'orphanVideos') => {
    const ok = await confirm(
      kind === 'frames'
        ? {
            title: 'Remove debug screenshots?',
            body: 'Deletes the cover frames and debug screenshots that no video uses. Videos are not touched.',
            confirmLabel: 'Remove screenshots',
            tone: 'destructive',
          }
        : {
            title: 'Remove unlinked video files?',
            body: `Deletes ${storage?.orphanVideos.count ?? 0} video files (${megabytes(storage?.orphanVideos.sizeMb ?? 0)}) that no video record points to. This cannot be undone.`,
            confirmLabel: 'Remove unlinked files',
            tone: 'destructive',
          },
    );
    if (!ok) return;
    setBusy(`cleanup-${kind}`);
    try {
      const result = await api.cleanup(kind === 'frames' ? { frames: true } : { orphanVideos: true });
      toast.success(result.message);
      await loadStorage();
    } catch (err) {
      toast.failure(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Settings">
        <span>Check that the studio can run, see what it stores, and read about it.</span>
      </PageHeader>

      <Section
        title="System check"
        description="Each line is one thing the studio needs. A problem line says how to fix it."
      >
        {checkError && (
          <p role="alert" className="text-[14px] text-apple-deep">
            {checkError}
          </p>
        )}
        {check === null && !checkError && <p className="text-ink-soft">Checking...</p>}
        {check && (
          <ul className="divide-y divide-line rounded-[10px] border border-line bg-sheet">
            {check.checks.map((c) => (
              <li key={c.id} className="flex gap-3 p-4">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-leaf-ink" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-5 shrink-0 text-apple-deep" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold">
                    {c.label}{' '}
                    <span className={c.ok ? 'text-leaf-ink' : 'text-apple-deep'}>{c.ok ? 'OK' : 'Problem'}</span>
                  </p>
                  <p className="text-[14px] text-ink-soft">{c.detail}</p>
                  {!c.ok && c.fix && <p className="mt-1 text-[14px]">{c.fix}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button onClick={runCheck} busy={checking}>
            Run check again
          </Button>
        </div>
      </Section>

      <Section
        title="Storage"
        description="Where the studio keeps videos and images on this computer."
      >
        {storageError && (
          <p role="alert" className="text-[14px] text-apple-deep">
            {storageError}
          </p>
        )}
        {storage === null && !storageError && <p className="text-ink-soft">Measuring...</p>}
        {storage && (
          <>
            <StorageBar storage={storage} />
            <p className="text-[14px]">
              {storage.orphanVideos.count} video files ({megabytes(storage.orphanVideos.sizeMb)}) aren't linked to any video record.
            </p>
            <p className="text-[13px] break-all text-ink-soft">Folder: {storage.root}</p>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button busy={busy === 'open-videos'} onClick={() => void openFolder('videos')}>
            Open videos folder
          </Button>
          <Button busy={busy === 'open-logs'} onClick={() => void openFolder('logs')}>
            Open logs folder
          </Button>
          <Button variant="destructive" busy={busy === 'cleanup-frames'} onClick={() => void cleanup('frames')}>
            Remove debug screenshots
          </Button>
          <Button
            variant="destructive"
            busy={busy === 'cleanup-orphanVideos'}
            disabled={!storage || storage.orphanVideos.count === 0}
            onClick={() => void cleanup('orphanVideos')}
          >
            Remove unlinked video files
          </Button>
        </div>
      </Section>

      <Section title="About">
        <p>
          KindredStudio makes short character videos. Each channel asks ChatGPT for the next prompt, makes the video in Grok,
          checks it for kids' safety, and posts it to TikTok and YouTube Shorts through the browser windows signed in for that
          channel.
        </p>
        <p className="text-ink-soft">Videos are posted publicly to the accounts signed in for each channel.</p>
        <p className="text-[14px] text-ink-soft">Version {health?.version ?? 'unknown'}</p>
      </Section>

      {dialog}
    </>
  );
}
