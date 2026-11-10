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
  const [isLaunchingBrowser, setIsLaunchingBrowser] = useState(false);
  const [isRunningBrowserRun, setIsRunningBrowserRun] = useState(false);
  const [browserStatusMsg, setBrowserStatusMsg] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

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
                Your session cookies and login states are stored locally in <code className="text-amber-400 font-mono">storage/browser_profile</code>. Log in once to your ChatGPT and Grok accounts in the interactive window, and Jev will automate prompt creation and video paste unattended.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isLaunchingBrowser}
              onClick={async () => {
                setIsLaunchingBrowser(true);
                setBrowserStatusMsg({ type: 'info', text: 'Launching Chromium and navigating to ChatGPT & Grok...' });
                try {
                  const res = await safeFetchJson('/api/browser/open', { method: 'POST' });
                  setBrowserStatusMsg({
                    type: 'success',
                    text: res.message || 'Chromium is open! Log into ChatGPT (Tab 1) and Grok (Tab 2).',
                  });
                } catch (err: any) {
                  setBrowserStatusMsg({ type: 'error', text: `Launch error: ${err.message}` });
                } finally {
                  setIsLaunchingBrowser(false);
                }
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-amber-400 rounded-xl border border-slate-700 transition flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{isLaunchingBrowser ? 'Opening Chromium...' : 'Launch Browser Window to Log In'}</span>
            </button>

            <button
              type="button"
              disabled={isRunningBrowserRun}
              onClick={async () => {
                setIsRunningBrowserRun(true);
                setBrowserStatusMsg({
                  type: 'info',
                  text: 'Autonomous Jev Agent starting: Composing prompt in ChatGPT, transferring to Grok, assembling video, and staging on TikTok...',
                });
                try {
                  const data = await safeFetchJson('/api/browser/run', { method: 'POST' });
                  if (data.success) {
                    setBrowserStatusMsg({
                      type: 'success',
                      text: `Autonomous Loop Completed! "${data.title}" (${data.durationSeconds || 18}s). QA Status: ${data.qaPassed ? 'PASSED (100% Kids Safe)' : 'Held for Review'}. Staged for TikTok publishing slot!`,
                    });
                  } else {
                    setBrowserStatusMsg({
                      type: 'error',
                      text: `Autonomous loop notice: ${data.error || data.message || 'Unknown error'}`,
                    });
                  }
                } catch (e: any) {
                  setBrowserStatusMsg({ type: 'error', text: `Automation error: ${e.message}` });
                } finally {
                  setIsRunningBrowserRun(false);
                }
              }}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-xl transition shadow-lg shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isRunningBrowserRun ? 'Autonomous Sequence in Progress...' : 'Run Full Autonomous Loop (ChatGPT → Grok → TikTok)'}</span>
            </button>
          </div>

          {browserStatusMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                browserStatusMsg.type === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                  : browserStatusMsg.type === 'error'
                  ? 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
                  : 'bg-amber-950/40 border border-amber-800/80 text-amber-300'
              }`}
            >
              <span>{browserStatusMsg.text}</span>
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
                1. Click <strong>"Launch Browser Window to Log In"</strong> above and log into your new ChatGPT account.
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

