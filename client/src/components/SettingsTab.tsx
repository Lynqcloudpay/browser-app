import React, { useState, useEffect } from 'react';
import { Settings, Key, DollarSign, CheckCircle2, Shield, Globe, Clock, Sparkles, MessageSquare, Search, ExternalLink } from 'lucide-react';
import { safeFetchJson } from '../utils/api';

interface SettingsTabProps {
  settings: any;
  connections: any[];
  onSaveSettings: (updated: any) => Promise<void>;
  onSaveConnection: (provider: string, apiKey: string, accountId: string) => Promise<void>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  connections,
  onSaveSettings,
  onSaveConnection,
}) => {
  const [formData, setFormData] = useState({
    operator_name: settings?.operator_name || 'Adult Creator',
    age_band: settings?.age_band || '5-7',
    language: settings?.language || 'en-US',
    timezone: settings?.timezone || 'America/New_York',
    daily_posts_target: settings?.daily_posts_target || 3,
    daily_budget_usd: settings?.daily_budget_usd || 15.0,
    max_cost_per_video_usd: settings?.max_cost_per_video_usd || 5.0,
    demo_mode: settings?.demo_mode === 1,
    revenue_creator_rewards_enabled: settings?.revenue_creator_rewards_enabled === 1,
    revenue_educational_licensing_enabled: settings?.revenue_educational_licensing_enabled === 1,
    revenue_brand_partnerships_enabled: settings?.revenue_brand_partnerships_enabled === 1,
    chatgpt_chat_url: settings?.chatgpt_chat_url || '',
  });

  const [chatGptUrlInput, setChatGptUrlInput] = useState(settings?.chatgpt_chat_url || '');
  const [isDetectingChatGpt, setIsDetectingChatGpt] = useState(false);
  const [isSavingChatGptUrl, setIsSavingChatGptUrl] = useState(false);
  const [chatGptStatusMsg, setChatGptStatusMsg] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (settings?.chatgpt_chat_url !== undefined) {
      setChatGptUrlInput(settings.chatgpt_chat_url || '');
      setFormData(prev => ({ ...prev, chatgpt_chat_url: settings.chatgpt_chat_url || '' }));
    }
  }, [settings?.chatgpt_chat_url]);

  const [connectionInputs, setConnectionInputs] = useState<Record<string, { key: string; id: string }>>({
    jev: { key: '', id: '' },
    openai: { key: '', id: '' },
    xai: { key: '', id: '' },
    buffer_tiktok: { key: '', id: '' },
  });

  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [runStatus, setRunStatus] = useState<any>({ state: 'idle', step: '' });
  const [accounts, setAccounts] = useState<any>(null);
  const accountBusy = accounts?.op?.state === 'working' || accounts?.op?.state === 'waiting_login';
  const [targets, setTargets] = useState<any>(null);
  const [targetsMsg, setTargetsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(['10:00']);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const runBusy = runStatus.state === 'running' || runStatus.state === 'waiting_login';

  // Live progress of the one-button run (also shows runs started by the daily schedule).
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const st = await safeFetchJson('/api/browser/run-status');
        if (!stopped) setRunStatus(st);
      } catch {
        /* server restarting */
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    safeFetchJson('/api/schedule')
      .then((sc) => {
        setSchedule(sc);
        if (Array.isArray(sc?.times) && sc.times.length) setScheduleTimes(sc.times);
      })
      .catch(() => {});
  }, []);

  // Account list + live progress of "Switch account" / "Check logins".
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const a = await safeFetchJson('/api/accounts');
        if (!stopped) setAccounts(a);
      } catch {
        /* server restarting */
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const startAccountOp = async (url: string) => {
    try {
      const a = await safeFetchJson(url, { method: 'POST', body: JSON.stringify({}) });
      if (a.sites) setAccounts(a);
      else setAccounts((prev: any) => ({ ...(prev || {}), op: { state: 'error', step: a.error || 'Could not start.' } }));
    } catch (e: any) {
      setAccounts((prev: any) => ({ ...(prev || {}), op: { state: 'error', step: e.message } }));
    }
  };

  useEffect(() => {
    safeFetchJson('/api/publish-targets')
      .then((t) => setTargets(t))
      .catch(() => {});
  }, []);

  const saveTargets = async (patch: any) => {
    setTargetsMsg(null);
    const previous = targets;
    setTargets({ ...targets, ...patch }); // instant feedback
    try {
      const t = await safeFetchJson('/api/publish-targets', { method: 'POST', body: JSON.stringify(patch) });
      if (t.error) throw new Error(t.error);
      setTargets(t);
    } catch (e: any) {
      setTargets(previous);
      setTargetsMsg({ type: 'error', text: e.message });
    }
  };

  const handleRunClick = async () => {
    try {
      const data = await safeFetchJson('/api/browser/run', { method: 'POST', body: JSON.stringify({}) });
      if (data.state) setRunStatus(data);
      else setRunStatus({ state: 'error', step: data.error || 'Could not start.', error: data.error });
    } catch (e: any) {
      setRunStatus({ state: 'error', step: e.message, error: e.message });
    }
  };

  const DEFAULT_SLOTS = ['10:00', '14:30', '18:30', '21:00', '07:00', '12:00', '16:00', '23:00'];
  const changeScheduleCount = (count: number) => {
    setScheduleTimes((prev) => {
      if (count <= prev.length) return prev.slice(0, count);
      const next = [...prev];
      for (const t of DEFAULT_SLOTS) {
        if (next.length >= count) break;
        if (!next.includes(t)) next.push(t);
      }
      return next;
    });
  };

  const saveSchedule = async (enabled: boolean) => {
    setSavingSchedule(true);
    setScheduleMsg(null);
    try {
      const sc = await safeFetchJson('/api/schedule', { method: 'POST', body: JSON.stringify({ enabled, times: scheduleTimes }) });
      if (sc.error) throw new Error(sc.error);
      setSchedule(sc);
      setScheduleMsg({
        type: 'success',
        text: enabled
          ? `Done. ${sc.times.length} video${sc.times.length > 1 ? 's' : ''} a day will be made and posted at ${sc.times.join(', ')}.`
          : 'Daily posting is turned off.',
      });
    } catch (e: any) {
      setScheduleMsg({ type: 'error', text: e.message });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    await onSaveSettings(formData);
    setSavingSettings(false);
    setSaveSuccessMsg('Operator preferences saved successfully.');
    setTimeout(() => setSaveSuccessMsg(''), 4000);
  };

  const handleConnectionSave = async (provider: string) => {
    const input = connectionInputs[provider];
    await onSaveConnection(provider, input.key, input.id);
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-amber-400" />
          Operator Studio Settings & API Connections
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Configure developmental parameters, publishing schedules, daily spend ceilings, and authorized credentials.
        </p>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Account Connections */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              Connected Provider Accounts
            </h3>
            <p className="text-xs text-slate-400">
              Official APIs for Jev decision-making, OpenAI on-demand writing, Grok video generation, and Buffer TikTok publishing.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {connections.map((conn) => {
            const isConnected = conn.status === 'connected';
            const input = connectionInputs[conn.provider] || { key: '', id: '' };

            return (
              <div
                key={conn.provider}
                className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-200">{conn.name}</h4>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                        isConnected
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}
                    >
                      {conn.status}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
                    Provider: {conn.provider}
                  </span>
                </div>

                <div className="flex flex-1 flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    placeholder="Enter API Key / Token..."
                    value={input.key}
                    onChange={(e) =>
                      setConnectionInputs({
                        ...connectionInputs,
                        [conn.provider]: { ...input, key: e.target.value },
                      })
                    }
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 font-mono"
                  />
                  {conn.provider === 'buffer_tiktok' && (
                    <input
                      type="text"
                      placeholder="TikTok Channel ID"
                      value={input.id}
                      onChange={(e) =>
                        setConnectionInputs({
                          ...connectionInputs,
                          [conn.provider]: { ...input, id: e.target.value },
                        })
                      }
                      className="w-full sm:w-40 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 font-mono"
                    />
                  )}
                  <button
                    onClick={() => handleConnectionSave(conn.provider)}
                    className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 rounded-xl border border-slate-700 transition shrink-0"
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Jev Browser Automation (ChatGPT -> Grok) Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Jev Browser Agent (ChatGPT → Grok Pipeline)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Jev uses Chromium to browse ChatGPT, formulate the prompt, copy the output, and paste it into Grok to create the video. No OpenAI or Grok developer APIs required.
            </p>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shrink-0">
            Playwright Automated
          </span>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="font-bold text-slate-200">Persistent Browser Session Profile</h5>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Your session cookies and login states are stored locally in <code className="text-amber-400 font-mono">storage/browser_profile</code>. The first time (or whenever a login expires) the run pauses and asks you to sign into ChatGPT, Grok and TikTok in the browser window; after that it runs by itself.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={runBusy}
              onClick={handleRunClick}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-xl transition shadow-lg shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{runBusy ? 'Working…' : 'Make & Post a Video Now'}</span>
            </button>
            <span className="text-[11px] text-slate-500">
              One click: opens the browser, asks you to sign in only if needed, then ChatGPT → Grok → TikTok.
            </span>
          </div>

          {runStatus.state !== 'idle' && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                runStatus.state === 'done'
                  ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                  : runStatus.state === 'error'
                  ? 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
                  : runStatus.state === 'waiting_login'
                  ? 'bg-sky-950/40 border border-sky-700/80 text-sky-200'
                  : 'bg-amber-950/40 border border-amber-800/80 text-amber-300'
              }`}
            >
              <span>
                {runStatus.state === 'waiting_login' && <strong>Sign-in needed — </strong>}
                {runStatus.state === 'error' && <strong>Stopped — </strong>}
                {runStatus.step}
                {runStatus.trigger === 'schedule' && runBusy && <em> (started by the daily schedule)</em>}
              </span>
              {runStatus.state === 'waiting_login' && (
                <button
                  type="button"
                  onClick={() => safeFetchJson('/api/browser/skip-login', { method: 'POST' }).catch(() => {})}
                  className="ml-auto shrink-0 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-[11px] font-bold rounded-lg cursor-pointer"
                >
                  I'm already signed in — continue
                </button>
              )}
            </div>
          )}
        </div>

        {/* Accounts */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Key className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h5 className="font-bold text-slate-200">Accounts</h5>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  Change which account each platform uses. <strong>Switch account</strong> opens the browser on just that platform,
                  signs it out, and waits while you sign in with the other account — then it closes the window and remembers it.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={accountBusy || runBusy}
              onClick={() => startAccountOp('/api/accounts/check')}
              className="shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] font-bold text-slate-300 rounded-lg border border-slate-700 transition cursor-pointer disabled:cursor-not-allowed"
            >
              Check logins
            </button>
          </div>

          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            {(accounts?.sites || []).map((site: any) => (
              <div key={site.key} className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-200 w-20">{site.name}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      site.state === 'in'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : site.state === 'out'
                        ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        : 'bg-slate-700/40 text-slate-400 border-slate-600/50'
                    }`}
                  >
                    {site.state === 'in' ? 'Signed in' : site.state === 'out' ? 'Signed out' : 'Not checked'}
                  </span>
                  {site.checkedAt && (
                    <span className="text-[10px] text-slate-500">{new Date(site.checkedAt).toLocaleString()}</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={accountBusy || runBusy}
                  onClick={() => {
                    const extra =
                      site.key === 'youtube'
                        ? ' This also signs the browser out of Google.'
                        : site.key === 'chatgpt'
                        ? ' Your "Create Mr Apple Videos" chat is re-detected for the new account.'
                        : '';
                    if (window.confirm(`Switch the ${site.name} account? It will be signed out, then you sign in with the other account.${extra}`)) {
                      startAccountOp(`/api/accounts/${site.key}/switch`);
                    }
                  }}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-[11px] font-bold rounded-lg transition cursor-pointer disabled:cursor-not-allowed"
                >
                  Switch account
                </button>
              </div>
            ))}
          </div>

          {accounts?.op && accounts.op.state !== 'idle' && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                accounts.op.state === 'done'
                  ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                  : accounts.op.state === 'error'
                  ? 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
                  : accounts.op.state === 'waiting_login'
                  ? 'bg-sky-950/40 border border-sky-700/80 text-sky-200'
                  : 'bg-amber-950/40 border border-amber-800/80 text-amber-300'
              }`}
            >
              <span>
                {accounts.op.state === 'waiting_login' && <strong>Sign-in needed — </strong>}
                {accounts.op.state === 'error' && <strong>Stopped — </strong>}
                {accounts.op.step}
              </span>
              {accounts.op.state === 'waiting_login' && (
                <button
                  type="button"
                  onClick={() => safeFetchJson('/api/accounts/cancel', { method: 'POST' }).catch(() => {})}
                  className="ml-auto shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold rounded-lg border border-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Where to post */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
          <div className="flex items-start gap-3">
            <ExternalLink className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="font-bold text-slate-200">Where to post each video</h5>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Every finished video is uploaded to each place you leave on. YouTube posts it publicly as a Short using the same browser
                window (your Google account must be signed in there).
              </p>
            </div>
          </div>
          {targets && (
            <div className="pt-2 border-t border-slate-800/80 space-y-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={targets.tiktok} onChange={(e) => saveTargets({ tiktok: e.target.checked })} />
                  <span className="font-semibold">TikTok</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={targets.youtube} onChange={(e) => saveTargets({ youtube: e.target.checked })} />
                  <span className="font-semibold">YouTube Shorts</span>
                </label>
              </div>
              {targets.youtube && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-1 text-slate-300">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={targets.youtubeMadeForKids}
                      onChange={(e) => saveTargets({ youtubeMadeForKids: e.target.checked })}
                    />
                    <span>Mark as "made for kids" (YouTube requires an answer; these are kids' videos)</span>
                  </label>
                </div>
              )}
            </div>
          )}
          {targetsMsg && (
            <div className="p-3 rounded-xl text-xs bg-rose-950/40 border border-rose-800/80 text-rose-300">{targetsMsg.text}</div>
          )}
        </div>

        {/* Daily automatic posting */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="font-bold text-slate-200">
                Post automatically every day
                {schedule?.installed && (
                  <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    ON · {(schedule.times || []).join(' · ')}
                  </span>
                )}
              </h5>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                At each time you choose, your Mac opens the browser by itself, makes one video and posts it — even if this app is closed.
                The Mac must be on (a sleeping Mac runs it when it wakes) and you must be logged in to macOS.
              </p>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-slate-300">
              <span className="text-[11px] text-slate-400">Videos per day</span>
              <select
                value={scheduleTimes.length}
                onChange={(e) => changeScheduleCount(Number(e.target.value))}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {scheduleTimes.map((t, i) => (
              <label key={i} className="flex items-center gap-1.5 text-slate-300">
                <span className="text-[11px] text-slate-500">#{i + 1}</span>
                <input
                  type="time"
                  value={t}
                  onChange={(e) => setScheduleTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200"
                />
              </label>
            ))}
            <button
              type="button"
              disabled={savingSchedule || scheduleTimes.some((t) => !t) || schedule?.platformSupported === false}
              onClick={() => saveSchedule(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-xl transition cursor-pointer disabled:cursor-not-allowed"
            >
              {schedule?.installed ? 'Save schedule' : 'Turn on daily posting'}
            </button>
            {schedule?.installed && (
              <button
                type="button"
                disabled={savingSchedule}
                onClick={() => saveSchedule(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-slate-300 rounded-xl border border-slate-700 transition cursor-pointer"
              >
                Turn off
              </button>
            )}
          </div>
          {schedule?.installed && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Today: {schedule.completedToday ?? 0} of {(schedule.times || []).length} scheduled video(s) made.
              {schedule.lastRun && (
                <>
                  {' '}
                  Last scheduled run {new Date(schedule.lastRun.at).toLocaleString()} —{' '}
                  <span
                    className={
                      schedule.lastRun.outcome === 'success'
                        ? 'text-emerald-400'
                        : schedule.lastRun.outcome === 'failed'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }
                  >
                    {schedule.lastRun.outcome}
                  </span>
                  : {schedule.lastRun.message}
                </>
              )}
            </p>
          )}
          {scheduleMsg && (
            <div
              className={`p-3 rounded-xl text-xs ${
                scheduleMsg.type === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
              }`}
            >
              {scheduleMsg.text}
            </div>
          )}
        </div>

        {/* Pinned Master Prompt Conversation Section */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <MessageSquare className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h5 className="font-bold text-slate-200">ChatGPT Master Prompt Chat: "Create Mr Apple Videos"</h5>
                  {settings?.chatgpt_chat_url ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      Active Chat Linked
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      Auto-Detect Pinned Chat
                    </span>
                  )}
                </div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  Jev connects to this conversation to submit <code className="text-amber-400 font-mono">"next"</code> and pull the latest video script. When changing ChatGPT accounts, Jev automatically searches your sidebar for your pinned chat, or you can paste the conversation URL directly below.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="url"
                  placeholder="https://chatgpt.com/c/your-new-conversation-id"
                  value={chatGptUrlInput}
                  onChange={(e) => setChatGptUrlInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingChatGptUrl || !chatGptUrlInput.trim()}
                  onClick={async () => {
                    setIsSavingChatGptUrl(true);
                    setChatGptStatusMsg(null);
                    try {
                      const res = await safeFetchJson('/api/browser/set-chatgpt-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: chatGptUrlInput.trim() }),
                      });
                      if (res.success) {
                        setChatGptStatusMsg({ type: 'success', text: 'ChatGPT conversation URL saved and linked!' });
                        await onSaveSettings({ ...formData, chatgpt_chat_url: chatGptUrlInput.trim() });
                      } else {
                        setChatGptStatusMsg({ type: 'error', text: res.error || 'Failed to save URL' });
                      }
                    } catch (e: any) {
                      setChatGptStatusMsg({ type: 'error', text: `Save error: ${e.message}` });
                    } finally {
                      setIsSavingChatGptUrl(false);
                    }
                  }}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition text-xs shrink-0 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isSavingChatGptUrl ? 'Saving...' : 'Save URL'}
                </button>

                <button
                  type="button"
                  disabled={isDetectingChatGpt}
                  onClick={async () => {
                    setIsDetectingChatGpt(true);
                    setChatGptStatusMsg({ type: 'info', text: 'Scanning ChatGPT sidebar for "Create Mr Apple Videos"...' });
                    try {
                      const res = await safeFetchJson('/api/browser/detect-chatgpt', { method: 'POST' });
                      if (res.success && res.url) {
                        setChatGptUrlInput(res.url);
                        setChatGptStatusMsg({
                          type: 'success',
                          text: `Found and linked: "${res.title}" (${res.url})`,
                        });
                        await onSaveSettings({ ...formData, chatgpt_chat_url: res.url });
                      } else {
                        setChatGptStatusMsg({
                          type: 'error',
                          text: res.message || 'Could not find "Create Mr Apple Videos" in sidebar. Make sure you are logged in.',
                        });
                      }
                    } catch (e: any) {
                      setChatGptStatusMsg({ type: 'error', text: `Detection error: ${e.message}` });
                    } finally {
                      setIsDetectingChatGpt(false);
                    }
                  }}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-400 font-bold rounded-xl border border-slate-700 transition text-xs shrink-0 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isDetectingChatGpt ? 'Detecting...' : 'Auto-Detect from Sidebar'}</span>
                </button>
              </div>
            </div>

            {chatGptStatusMsg && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  chatGptStatusMsg.type === 'success'
                    ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                    : chatGptStatusMsg.type === 'error'
                    ? 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
                    : 'bg-indigo-950/40 border border-indigo-800/80 text-indigo-300'
                }`}
              >
                <span>{chatGptStatusMsg.text}</span>
              </div>
            )}

            <div className="bg-slate-900/40 rounded-lg p-2.5 text-[11px] text-slate-400 border border-slate-800/60 flex items-start gap-2">
              <span className="font-bold text-amber-400 shrink-0">Account Switch Tip:</span>
              <span>
                1. Click <strong>"Make &amp; Post a Video Now"</strong> above and sign into your new ChatGPT account when asked.
                2. Open or pin your <strong>"Create Mr Apple Videos"</strong> chat.
                3. Click <strong>"Auto-Detect from Sidebar"</strong> or paste its URL here to link it permanently.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Operator Preferences Form */}
      <form onSubmit={handleSettingsSubmit} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6">
        <h3 className="text-sm font-bold text-white pb-3 border-b border-slate-800">
          Studio Operational Controls
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {/* Developmental Age Band */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Developmental Age Band
            </label>
            <select
              value={formData.age_band}
              onChange={(e) => setFormData({ ...formData, age_band: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
            >
              <option value="2-4">Ages 2–4 (Toddler / Preschool)</option>
              <option value="5-7">Ages 5–7 (Early Elementary)</option>
              <option value="8-10">Ages 8–10 (Upper Elementary)</option>
            </select>
          </div>

          {/* Daily Posts Target */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Daily Posts Target (Spaced)
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={formData.daily_posts_target}
              onChange={(e) => setFormData({ ...formData, daily_posts_target: parseInt(e.target.value) || 3 })}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">Editable starting point: 3 posts daily</span>
          </div>

          {/* Timezone */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Studio Timezone
            </label>
            <select
              value={formData.timezone}
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
            >
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="America/Chicago">America/Chicago (CST)</option>
              <option value="America/Denver">America/Denver (MST)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
            </select>
          </div>

          {/* Daily Budget Cap */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Daily Budget Cap ($ USD)
            </label>
            <input
              type="number"
              step="1.00"
              value={formData.daily_budget_usd}
              onChange={(e) => setFormData({ ...formData, daily_budget_usd: parseFloat(e.target.value) || 15.0 })}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 font-mono"
            />
          </div>

          {/* Max Cost Per Video */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Max Cost Per Video ($ USD)
            </label>
            <input
              type="number"
              step="0.50"
              value={formData.max_cost_per_video_usd}
              onChange={(e) => setFormData({ ...formData, max_cost_per_video_usd: parseFloat(e.target.value) || 5.0 })}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 font-mono"
            />
          </div>

          {/* Language */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Content Language
            </label>
            <input
              type="text"
              value={formData.language}
              onChange={(e) => setFormData({ ...formData, language: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Permitted Revenue Sources */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
            Permitted Revenue Sources
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.revenue_creator_rewards_enabled}
                onChange={(e) => setFormData({ ...formData, revenue_creator_rewards_enabled: e.target.checked })}
                className="rounded accent-amber-500 cursor-pointer"
              />
              <span>TikTok Creator Rewards (&gt;60s)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.revenue_educational_licensing_enabled}
                onChange={(e) => setFormData({ ...formData, revenue_educational_licensing_enabled: e.target.checked })}
                className="rounded accent-amber-500 cursor-pointer"
              />
              <span>Educational Licensing (B2B)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.revenue_brand_partnerships_enabled}
                onChange={(e) => setFormData({ ...formData, revenue_brand_partnerships_enabled: e.target.checked })}
                className="rounded accent-amber-500 cursor-pointer"
              />
              <span>Family Co-Viewing Brand Grants</span>
            </label>
          </div>
        </div>

        {/* Demo Mode Toggle */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-200">Demo Sandbox Mode</h4>
            <p className="text-[11px] text-slate-400">
              Simulates external video generation and live publishing receipts without consuming paid credits.
            </p>
          </div>
          <input
            type="checkbox"
            checked={formData.demo_mode}
            onChange={(e) => setFormData({ ...formData, demo_mode: e.target.checked })}
            className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
          />
        </div>

        <button
          type="submit"
          disabled={savingSettings}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-lg shadow-amber-500/20 disabled:opacity-50"
        >
          {savingSettings ? 'Saving...' : 'Save All Preferences'}
        </button>
      </form>
    </div>
  );
};

export default SettingsTab;

