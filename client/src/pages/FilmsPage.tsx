import { useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { absolute, relativeTime } from '../format';
import { usePolling } from '../hooks/usePolling';
import { useAppData } from '../state/appData';
import type { FilmModel, FilmsInfo, FilmStatus } from '../types';

const STATE_LABEL: Record<FilmStatus['state'], string> = {
  idle: 'Ready',
  running: 'Making the film',
  done: 'Finished',
  error: 'Stopped with an error',
  cancelled: 'Stopped',
};

const INSTALL_COMMAND =
  'cd ~ && curl -fsSL https://raw.githubusercontent.com/lemomo-ai/lemo-opuscar/main/plugin/skills/lemo-opuscar/scripts/setup.sh | sh && sh ~/lemo-opuscar/plugin/skills/lemo-opuscar/scripts/setup.sh deps voice music';

const LENGTHS = [15, 30, 45, 60];

export function FilmsPage() {
  const { channels } = useAppData();
  const [info, setInfo] = useState<FilmsInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState('');
  const [style, setStyle] = useState('');
  const [topic, setTopic] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [model, setModel] = useState<FilmModel>('sonnet');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const running = info?.status.state === 'running';

  usePolling(
    async (isActive) => {
      try {
        const next = await api.getFilms();
        if (!isActive()) return;
        setInfo(next);
        setLoadError(null);
      } catch (err) {
        if (isActive()) setLoadError(errorMessage(err));
      }
    },
    running ? 3000 : 15000,
    [running],
  );

  // Claude films use the styles that need no image generator.
  const styles = useMemo(() => (info?.styles ?? []).filter((s) => !s.needsImages), [info]);
  const selectedStyle = styles.find((s) => s.slug === style) ?? styles[0];
  const selectedChannel = channelId || (channels?.[0] ? String(channels[0].id) : '');
  const canSubmit = Boolean(info?.installed) && !running && !submitting && topic.trim().length > 0 && Boolean(selectedChannel) && Boolean(selectedStyle);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedStyle) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await api.startFilm({ channelId: Number(selectedChannel), style: selectedStyle.slug, topic: topic.trim(), seconds, model });
      setTopic('');
      setInfo(await api.getFilms());
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function stop() {
    setStopping(true);
    try {
      await api.stopFilm();
      setInfo(await api.getFilms());
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setStopping(false);
    }
  }

  const status = info?.status;

  return (
    <>
      <PageHeader title="Claude films">
        <span>
          Claude writes and renders a short animated film in code (lemo-opuscar), using your Claude account on this Mac. No
          API keys. A film takes 30–60 minutes. It is saved to the Videos page; nothing posts until you click Post now.
        </span>
      </PageHeader>

      {loadError && (
        <p role="alert" className="mb-5 text-[14px] text-apple-deep">
          {loadError}
        </p>
      )}

      {info === null ? (
        <p className="text-ink-soft">Loading...</p>
      ) : (
        <div className="space-y-6">
          {!info.installed && (
            <section className="rounded-card border border-line bg-sheet p-5">
              <h2 className="text-[16px] font-bold">The film library is not installed</h2>
              <p className="mt-1.5 text-[14px] text-ink-soft">Run this in Terminal once, then come back to this page:</p>
              <pre className="mt-3 overflow-x-auto rounded-[10px] bg-paper p-3 font-mono text-[13px] whitespace-pre-wrap break-all">
                {INSTALL_COMMAND}
              </pre>
            </section>
          )}

          <form onSubmit={submit} className="rounded-card border border-line bg-sheet p-5 space-y-5">
            <div className="grid gap-5 min-[700px]:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
                Channel
                <select
                  value={selectedChannel}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
                >
                  {(channels ?? []).map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
                Style
                <select
                  value={selectedStyle?.slug ?? ''}
                  onChange={(e) => setStyle(e.target.value)}
                  className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
                >
                  {styles.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {`${s.name} — ${s.category}`}
                    </option>
                  ))}
                </select>
                {selectedStyle?.line && <span className="text-[13px] font-normal text-ink-soft">{selectedStyle.line}</span>}
              </label>
            </div>

            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              What is the film about?
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="For example, a little robot who learns to plant a garden"
                className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
              />
            </label>

            <div className="flex flex-wrap items-end gap-5">
              <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
                Length
                <select
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                  className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
                >
                  {LENGTHS.map((n) => (
                    <option key={n} value={n}>
                      {n} s
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
                Model
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as FilmModel)}
                  className="rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px] font-normal"
                >
                  <option value="sonnet">Sonnet (default)</option>
                  <option value="opus">Opus (uses more of your plan)</option>
                </select>
              </label>

              <Button type="submit" variant="primary" busy={submitting} disabled={!canSubmit}>
                Make film
              </Button>
            </div>

            {formError && (
              <p role="alert" className="text-[14px] text-apple-deep">
                {formError}
              </p>
            )}
          </form>

          {status && status.state !== 'idle' && (
            <section aria-label="Film status" className="rounded-card border border-line bg-sheet p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold">
                  {STATE_LABEL[status.state]}
                  {status.startedAt && (
                    <span className="ml-2 font-normal text-ink-soft" title={absolute(status.startedAt)}>
                      started {relativeTime(status.startedAt)}
                    </span>
                  )}
                </p>
                {running && (
                  <Button variant="destructive" size="sm" busy={stopping} onClick={() => void stop()}>
                    Stop
                  </Button>
                )}
              </div>
              {(running || status.state === 'done') && <FilmProgress status={status} />}
              {status.message && <p className="text-[14px] text-ink-soft">{status.message}</p>}
              {status.log.length > 0 && (
                <pre className="max-h-72 overflow-auto rounded-[10px] bg-paper p-3 font-mono text-[12px] whitespace-pre-wrap break-words">
                  {status.log.slice(-15).join('\n')}
                </pre>
              )}
              {status.state === 'done' && status.jobId && (
                <a href="#/videos" className="inline-block font-semibold underline underline-offset-4">
                  Open on Videos page
                </a>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}

/** Minutes left, estimated from the time spent so far and the share of the work done (shown from 15% on). */
function minutesLeft(status: FilmStatus): number | null {
  if (!status.startedAt || status.percent < 15 || status.percent >= 100) return null;
  const spentMin = (Date.now() - Date.parse(status.startedAt)) / 60000;
  return Math.max(1, Math.round((spentMin * (100 - status.percent)) / status.percent));
}

function FilmProgress({ status }: { status: FilmStatus }) {
  const pct = Math.max(2, Math.min(100, status.percent));
  const spent = status.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(status.startedAt)) / 60000)) : 0;
  const left = minutesLeft(status);
  const done = status.state === 'done';
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="font-medium">{done ? 'Finished' : status.stageLabel}</span>
        <span className="tabular-nums text-ink-soft">{status.percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Film progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status.percent}
        className="h-2.5 w-full overflow-hidden rounded-full bg-paper"
      >
        <div
          className={`h-full rounded-full bg-leaf transition-[width] duration-700 ${done ? '' : 'animate-pulse'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[13px] text-ink-soft tabular-nums">
        {done
          ? `Took ${spent} min.`
          : left !== null
            ? `${spent} min so far · about ${left} min left (estimate)`
            : `${spent} min so far · films usually take 30–60 min`}
      </p>
    </div>
  );
}
