import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Section } from '../../components/Section';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toasts';
import type { ChannelView, Insights, SmartSettings } from '../../types';

const buttonClass =
  'cursor-pointer rounded-[10px] bg-ink px-4 py-2 font-semibold text-white disabled:opacity-50';

const warnClass = 'rounded-[10px] bg-honey-wash p-3 text-[14px] text-honey-ink';

/** 0 -> "12 AM", 13 -> "1 PM". */
function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** One feature switch with a bold label and a grey explanation. */
function FeatureSwitch({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Switch checked={checked} disabled={disabled} onChange={onChange}>
      <span className="font-semibold">{label}</span>
      <span className="block text-[13px] text-ink-soft">{help}</span>
    </Switch>
  );
}

/** Multi-line text box that saves when it loses focus, one entry per line. */
function LinesBox({
  id,
  label,
  hint,
  placeholder,
  rows,
  value,
  onSave,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder: string;
  rows: number;
  value: string[];
  onSave: (lines: string[]) => void;
}) {
  const joined = value.join('\n');
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const commit = () => {
    const next = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (next.join('\n') !== joined) onSave(next);
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className="w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
      />
      {hint && <p className="mt-1 text-[13px] text-ink-soft">{hint}</p>}
    </div>
  );
}

export function SmartSection({ channel }: { channel: ChannelView }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const id = channel.id;
  const [data, setData] = useState<Insights | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  // Load on mount and whenever the channel changes. Ignore a reply that arrives after the channel changed.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .insights(id)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) toastRef.current.failure(err);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const reload = useCallback(async () => {
    try {
      setData(await api.insights(id));
    } catch (err) {
      toastRef.current.failure(err);
    }
  }, [id]);

  const running = data?.refresh?.state === 'running';

  // While a refresh runs, poll every 3 seconds until it finishes.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      api
        .insights(id)
        .then(setData)
        .catch((err) => toastRef.current.failure(err));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [running, id]);

  const save = async (patch: Partial<SmartSettings>) => {
    setSaving(true);
    try {
      setData(await api.saveSmart(id, patch));
    } catch (err) {
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const refreshNow = async () => {
    setStarting(true);
    try {
      await api.refreshInsights(id);
      await reload();
    } catch (err) {
      toast.failure(err);
    } finally {
      setStarting(false);
    }
  };

  if (!data) {
    return (
      <Section title="Smart features" description="Let the app learn what works: views per video, trends, and better prompts. Turn it off any time.">
        <p className="text-[14px] text-ink-soft">Loading…</p>
      </Section>
    );
  }

  const s = data.settings;
  const usable = data.trends.filter((t) => t.usable);
  const notUsable = data.trends.filter((t) => !t.usable);

  return (
    <Section title="Smart features" description="Let the app learn what works: views per video, trends, and better prompts. Turn it off any time.">
      <Switch checked={s.enabled} disabled={saving} onChange={(v) => void save({ enabled: v })}>
        <span className="font-semibold">Use smart features</span>
        <span className="block text-[13px] text-ink-soft">
          {s.enabled
            ? 'On: the app reads views and trends and uses them to make better videos.'
            : 'Off: the app works exactly as before. Your choices below are kept.'}
        </span>
      </Switch>

      {!data.jevReady && (
        <p role="alert" className={warnClass}>
          Jev is not set up (no TYPESAFE_API_KEY in .env), so trends cannot be checked for kids' safety and none will be used.
        </p>
      )}

      {data.privateAccount && (
        <p role="alert" className={warnClass}>
          Your TikTok account is private, so only your followers can see the videos. To reach more people, open TikTok → Profile → ☰ →
          Settings and privacy → Privacy, and turn Private account off.
        </p>
      )}

      {s.enabled && (
        <>
          <FeatureSwitch
            label="Read views and trends"
            help="After a video posts (at most every 6 hours), read views from TikTok and YouTube Studio, TikTok's trending topics, and ask ChatGPT what is trending. Jev keeps only kid-safe trends that fit this channel."
            checked={s.collect}
            disabled={saving}
            onChange={(v) => void save({ collect: v })}
          />

          <FeatureSwitch
            label="Smarter prompts"
            help="Each video follows one trend that Jev picks like a marketing manager: new trends get tested, and the ones that get views are repeated."
            checked={s.smartPrompts}
            disabled={saving}
            onChange={(v) => void save({ smartPrompts: v })}
          />

          <FeatureSwitch
            label="Title check"
            help="Jev rates each new title. A weak one makes ChatGPT write another idea once, before Grok makes the video."
            checked={s.hookCheck}
            disabled={saving}
            onChange={(v) => void save({ hookCheck: v })}
          />

          <FeatureSwitch
            label="Best posting times"
            help="Random schedules lean toward the hours your videos got the most views."
            checked={s.bestTimes}
            disabled={saving}
            onChange={(v) => void save({ bestTimes: v })}
          />

          <FeatureSwitch
            label="Rotate TikTok sounds"
            help="Use a different TikTok library sound each video, from the list below (needs TikTok sound set to TikTok library)."
            checked={s.soundRotation}
            disabled={saving}
            onChange={(v) => void save({ soundRotation: v })}
          />
          {s.soundRotation && (
            <LinesBox
              id="smart-sounds"
              label="TikTok sounds to rotate"
              rows={4}
              placeholder="https://www.tiktok.com/music/Chicken-Banana-7465696476092042006"
              hint="One sound link or name per line."
              value={s.sounds}
              onSave={(lines) => void save({ sounds: lines })}
            />
          )}

          <FeatureSwitch
            label="First comment on TikTok"
            help="After each TikTok post, the channel comments on its own video with a question to get replies. (YouTube comments are off on made-for-kids videos.)"
            checked={s.firstComment}
            disabled={saving}
            onChange={(v) => void save({ firstComment: v })}
          />
          {s.firstComment && (
            <LinesBox
              id="smart-comments"
              label="Comments to post"
              rows={4}
              placeholder="Which animal should dance next? 👇"
              hint="Leave empty to use built-in questions."
              value={s.comments}
              onSave={(lines) => void save({ comments: lines })}
            />
          )}

          <div className="space-y-5 border-t border-line pt-4">
            <h3 className="text-[14px] font-semibold">Insights</h3>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14px] text-ink-soft">
                {data.collectedAt ? `Last updated: ${new Date(data.collectedAt).toLocaleString()}` : 'Not collected yet.'}
              </p>
              <button type="button" className={buttonClass} disabled={running || starting} onClick={() => void refreshNow()}>
                Refresh now
              </button>
            </div>

            {data.refresh && (
              <p role="status" className="text-[13px] text-ink-soft">
                {running ? 'Updating: ' : 'Last refresh: '}
                {data.refresh.message}
              </p>
            )}

            <div>
              <h4 className="mb-2 text-[13px] font-semibold">Jev's strategy</h4>
              <p className="text-[14px]">
                Tests new trends first, then repeats the ones that get views (as often as they keep winning).
              </p>
              {data.lastDecision ? (
                <p className="mt-1 text-[13px] text-ink-soft">
                  Last video: <span className="font-semibold text-ink">{data.lastDecision.trend}</span>.{' '}
                  {data.lastDecision.reason}
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-ink-soft">No video made with a trend yet.</p>
              )}
              {data.trendScores.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px]">
                  {data.trendScores.slice(0, 8).map((t) => (
                    <li key={t.name}>
                      <span className="font-semibold">{t.name}</span>
                      <span className="text-ink-soft">
                        {' '}
                        — {t.videos} video{t.videos === 1 ? '' : 's'}, avg {Math.round(t.avgViews ?? 0).toLocaleString()} views
                      </span>
                      {t.winner && (
                        <span className="ml-2 rounded bg-leaf-wash px-1.5 py-0.5 text-[12px] font-semibold text-leaf-ink">Winner</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-[13px] font-semibold">Trends that fit</h4>
              {usable.length > 0 ? (
                <ul className="space-y-1.5 text-[14px]">
                  {usable.slice(0, 8).map((t, i) => (
                    <li key={`${t.source}-${t.name}-${i}`}>
                      <span className="font-semibold">{t.name}</span>
                      {t.detail && <span className="text-ink-soft"> — {t.detail}</span>}{' '}
                      <span className="rounded bg-paper px-1.5 py-0.5 text-[12px] text-ink-soft">
                        {/tiktok/i.test(t.source) ? 'TikTok' : 'ChatGPT'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-soft">None yet.</p>
              )}

              {notUsable.length > 0 && (
                <details className="mt-3 text-[13px]">
                  <summary className="cursor-pointer text-ink-soft">Other trends (not safe or not a fit)</summary>
                  <ul className="mt-2 space-y-1">
                    {notUsable.map((t, i) => {
                      const parts: string[] = [];
                      if (t.kid_safe !== null) parts.push(`safe ${Math.round(t.kid_safe * 100)}%`);
                      if (t.fits !== null) parts.push(`fit ${Math.round(t.fits * 100)}%`);
                      return (
                        <li key={`${t.source}-${t.name}-${i}`}>
                          {t.name} <span className="text-ink-soft">({parts.length ? parts.join(', ') : 'not checked'})</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-[13px] font-semibold">Most viewed videos</h4>
              {data.videos.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-ink-soft">
                        <th className="py-1 pr-3 font-semibold">Title</th>
                        <th className="py-1 pr-3 text-right font-semibold">TikTok views</th>
                        <th className="py-1 pr-3 text-right font-semibold">YouTube views</th>
                        <th className="py-1 pr-3 text-right font-semibold">Likes</th>
                        <th className="py-1 text-right font-semibold">Title score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.videos.slice(0, 8).map((v, i) => {
                        const link = v.tiktok_url || v.youtube_url;
                        const cell = (n: number, url: string | null, label: string) =>
                          url && n > 0 ? (
                            <a href={url} target="_blank" rel="noreferrer" aria-label={`${label}: open the video`} className="font-semibold text-ink underline underline-offset-2 hover:no-underline">
                              {n.toLocaleString()}
                            </a>
                          ) : (
                            n.toLocaleString()
                          );
                        return (
                          <tr key={v.job_id ?? i} className="border-t border-line">
                            <td className="max-w-[12rem] truncate py-1 pr-3" title={v.title}>
                              {link ? (
                                <a href={link} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-2 hover:no-underline">
                                  {v.title}
                                </a>
                              ) : (
                                v.title
                              )}
                            </td>
                            <td className="py-1 pr-3 text-right">{cell(v.tiktok_views, v.tiktok_url, 'TikTok views')}</td>
                            <td className="py-1 pr-3 text-right">{cell(v.youtube_views, v.youtube_url, 'YouTube views')}</td>
                            <td className="py-1 pr-3 text-right">{v.likes.toLocaleString()}</td>
                            <td className="py-1 text-right">{v.hook_score !== null ? Math.round(v.hook_score * 100) : '–'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[13px] text-ink-soft">No views read yet.</p>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-[13px] font-semibold">Best hours</h4>
              {data.bestHours.length > 0 ? (
                <p className="text-[14px]">
                  {data.bestHours
                    .map((b) => `${hourLabel(b.hour)} (avg ${Math.round(b.avgViews).toLocaleString()} views)`)
                    .join(', ')}
                </p>
              ) : (
                <p className="text-[13px] text-ink-soft">Needs a few more videos.</p>
              )}
            </div>

            <details className="text-[13px]">
              <summary className="cursor-pointer text-ink-soft">Next message to ChatGPT</summary>
              <p className="mt-2 text-[13px] whitespace-pre-wrap">{data.nextMessage}</p>
            </details>
          </div>
        </>
      )}
    </Section>
  );
}
