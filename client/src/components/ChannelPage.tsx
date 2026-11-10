import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Key,
  Clock,
  Globe,
  Sliders,
  CheckCircle2,
  Upload,
  Image as ImageIcon,
  MessageSquare,
  Search,
  ExternalLink,
  Edit2,
  Check,
  Shield,
  Video,
  AlertTriangle,
} from 'lucide-react';
import { safeFetchJson } from '../utils/api';

interface ChannelPageProps {
  channelId: number;
  onBack: () => void;
}

export const ChannelPage: React.FC<ChannelPageProps> = ({ channelId, onBack }) => {
  const [channel, setChannel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Editable Name State
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Run Status State
  const [runStatus, setRunStatus] = useState<any>({ state: 'idle', step: '' });

  // Accounts State
  const [accounts, setAccounts] = useState<any>(null);
  const accountBusy = accounts?.op?.state === 'working' || accounts?.op?.state === 'waiting_login';
  const runBusy = runStatus.state === 'running' || runStatus.state === 'waiting_login';

  // ChatGPT Chat URL State
  const [chatGptUrlInput, setChatGptUrlInput] = useState('');
  const [chatGptNameInput, setChatGptNameInput] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [isDetectingChatGpt, setIsDetectingChatGpt] = useState(false);
  const [chatGptMsg, setChatGptMsg] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  // Reference Image Upload State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageTimestamp, setImageTimestamp] = useState(Date.now());
  const [imageMsg, setImageMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Schedule State
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(['10:00']);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [otherChannels, setOtherChannels] = useState<{ id: number; name: string; schedule_enabled: boolean; schedule_times: string[] }[]>([]);

  // Targets / Grok Message
  const [grokSavedMsg, setGrokSavedMsg] = useState('');

  const loadChannelData = async () => {
    try {
      const [data, channelsRes] = await Promise.all([
        safeFetchJson(`/api/channels/${channelId}`),
        safeFetchJson('/api/channels'),
      ]);
      if (data?.id) {
        setChannel(data);
        setNameInput(data.name || '');
        setChatGptUrlInput(data.chatgpt_chat_url || '');
        setChatGptNameInput(data.chatgpt_chat_name || '');
        setHashtagInput(data.hashtag_hint || '');
        if (Array.isArray(data.schedule_times) && data.schedule_times.length) {
          setScheduleTimes(data.schedule_times);
        }
      }
      if (channelsRes?.channels) {
        setOtherChannels(channelsRes.channels.filter((c: any) => c.id !== channelId));
      }
    } catch (e: any) {
      console.warn('Could not load channel:', e.message);
    } finally {
      setLoading(false);
    }
  };

  const scheduleConflicts = useMemo(() => {
    const conflicts: { time: string; channelName: string }[] = [];
    if (!channel?.schedule_enabled) return conflicts;
    for (const time of scheduleTimes) {
      for (const oc of otherChannels) {
        if (oc.schedule_enabled && Array.isArray(oc.schedule_times) && oc.schedule_times.includes(time)) {
          conflicts.push({ time, channelName: oc.name });
        }
      }
    }
    return conflicts;
  }, [scheduleTimes, channel?.schedule_enabled, otherChannels]);

  useEffect(() => {
    loadChannelData();
  }, [channelId]);

  // Live polling for run status and account operations
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const [rs, acc] = await Promise.all([
          safeFetchJson(`/api/channels/${channelId}/run-status`),
          safeFetchJson(`/api/channels/${channelId}/accounts`),
        ]);
        if (!stopped) {
          if (rs?.state) setRunStatus(rs);
          if (acc?.sites) setAccounts(acc);
        }
      } catch {
        /* server busy */
      }
    };
    tick();
    const interval = setInterval(tick, 2500);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [channelId]);

  const patchChannel = async (patch: any) => {
    try {
      const updated = await safeFetchJson(`/api/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (updated?.id) {
        setChannel(updated);
      }
      return updated;
    } catch (err: any) {
      alert(`Could not update: ${err.message}`);
      throw err;
    }
  };

  const handleSaveName = async () => {
    const clean = nameInput.trim();
    if (!clean || clean === channel?.name) {
      setIsEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await patchChannel({ name: clean });
      setIsEditingName(false);
    } finally {
      setSavingName(false);
    }
  };

  const handleRunClick = async () => {
    try {
      const data = await safeFetchJson(`/api/channels/${channelId}/run`, {
        method: 'POST',
        body: JSON.stringify({
          targetDurationSec: channel?.grok_duration,
          targetResolution: channel?.grok_resolution,
        }),
      });
      if (data.state) setRunStatus(data);
      else setRunStatus({ state: 'error', step: data.error || 'Could not start.', error: data.error });
    } catch (e: any) {
      setRunStatus({ state: 'error', step: e.message, error: e.message });
    }
  };

  const startAccountOp = async (url: string) => {
    try {
      const a = await safeFetchJson(url, { method: 'POST', body: JSON.stringify({}) });
      if (a.sites) setAccounts(a);
      else setAccounts((prev: any) => ({ ...(prev || {}), op: { state: 'error', step: a.error || 'Could not start.' } }));
    } catch (e: any) {
      setAccounts((prev: any) => ({ ...(prev || {}), op: { state: 'error', step: e.message } }));
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageMsg(null);
    setUploadingImage(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/channels/${channelId}/reference-image`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: buffer,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');

      setImageTimestamp(Date.now());
      setImageMsg({ type: 'success', text: 'Reference image updated successfully.' });
      loadChannelData();
    } catch (err: any) {
      setImageMsg({ type: 'error', text: err.message || 'Could not upload image.' });
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveChatGptUrl = async () => {
    setChatGptMsg(null);
    try {
      await patchChannel({
        chatgpt_chat_url: chatGptUrlInput.trim(),
        chatgpt_chat_name: chatGptNameInput.trim(),
        hashtag_hint: hashtagInput.trim(),
      });
      setChatGptMsg({ type: 'success', text: 'ChatGPT settings saved.' });
      setTimeout(() => setChatGptMsg(null), 3000);
    } catch (e: any) {
      setChatGptMsg({ type: 'error', text: e.message });
    }
  };

  const handleDetectChatGptUrl = async () => {
    setIsDetectingChatGpt(true);
    setChatGptMsg({ type: 'info', text: 'Opening ChatGPT in your browser to detect the chat...' });
    try {
      const data = await safeFetchJson(`/api/channels/${channelId}/detect-chatgpt-url`, { method: 'POST' });
      if (data.success && data.url) {
        setChatGptUrlInput(data.url);
        setChatGptMsg({ type: 'success', text: `Detected: "${data.title || data.url}"` });
        loadChannelData();
      } else {
        setChatGptMsg({ type: 'error', text: data.message || 'Could not find the conversation in your sidebar.' });
      }
    } catch (err: any) {
      setChatGptMsg({ type: 'error', text: err.message });
    } finally {
      setIsDetectingChatGpt(false);
    }
  };

  const handleGrokChange = async (patch: Partial<{ grok_resolution: '480p' | '720p'; grok_duration: 6 | 10 | 15 }>) => {
    setGrokSavedMsg('');
    await patchChannel(patch);
    setGrokSavedMsg('Saved');
    setTimeout(() => setGrokSavedMsg(''), 2500);
  };

  const handleSaveSchedule = async (enabled: boolean, times: string[]) => {
    setSavingSchedule(true);
    setScheduleMsg(null);
    try {
      await patchChannel({
        schedule_enabled: enabled,
        schedule_times: times,
      });
      setScheduleMsg({ type: 'success', text: enabled ? `Daily posting active (${times.length} times/day)` : 'Schedule paused' });
      setTimeout(() => setScheduleMsg(null), 3000);
    } catch (e: any) {
      setScheduleMsg({ type: 'error', text: e.message });
    } finally {
      setSavingSchedule(false);
    }
  };

  const DEFAULT_SLOTS = ['10:00', '14:30', '18:30', '21:00', '07:00', '12:00', '16:00', '23:00'];
  const changeScheduleCount = (count: number) => {
    setScheduleTimes((prev) => {
      if (count <= prev.length) return prev.slice(0, count);
      const next = [...prev];
      for (const slot of DEFAULT_SLOTS) {
        if (!next.includes(slot)) next.push(slot);
        if (next.length === count) break;
      }
      return next;
    });
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 text-sm">Loading channel...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Bar with Back button and Channel Name */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition cursor-pointer flex items-center gap-1.5 text-xs font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Studio</span>
          </button>

          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                className="bg-slate-950 border border-amber-500 text-white text-lg font-bold rounded-lg px-2.5 py-1 focus:outline-none"
              />
              <button
                type="button"
                disabled={savingName}
                onClick={handleSaveName}
                className="p-1.5 bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 cursor-pointer"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {channel?.name}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                title="Rename channel"
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                CH #{channelId}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => safeFetchJson(`/api/channels/${channelId}/open-browser`, { method: 'POST' }).catch(() => {})}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition cursor-pointer flex items-center gap-1.5"
          >
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <span>Open Browser Window</span>
          </button>
        </div>
      </div>

      {/* Card 1: One-Click Run & Live Progress */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Autonomous Production Engine
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Generates a brand-new prompt in ChatGPT, renders the video in Grok with your character reference picture, and uploads directly to TikTok & YouTube Shorts.
            </p>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
            Channel #{channelId}
          </span>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs space-y-3">
          <div className="pt-1 flex flex-wrap items-center gap-3">
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
              One click: checks logins, writes prompt via ChatGPT, generates in Grok ({channel?.grok_resolution || '720p'} / {channel?.grok_duration || 15}s), and uploads.
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
                {runStatus.trigger === 'schedule' && runBusy && <em> (started by daily schedule)</em>}
              </span>
              {runStatus.state === 'waiting_login' && (
                <button
                  type="button"
                  onClick={() => safeFetchJson(`/api/channels/${channelId}/skip-login`, { method: 'POST' }).catch(() => {})}
                  className="ml-auto shrink-0 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-[11px] font-bold rounded-lg cursor-pointer"
                >
                  I'm already signed in — continue
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Card 2: Character Reference Picture */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-amber-400" />
              Character Reference Picture
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Grok uses this reference image to lock character appearance across every video generated for this channel.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
          <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0">
            <img
              src={`/api/channels/${channelId}/reference-image?t=${imageTimestamp}`}
              alt="Channel Reference"
              className="w-full h-full object-cover"
              onError={(e) => {
                // If 404 / no image yet
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 pointer-events-none -z-0">
              <ImageIcon className="w-8 h-8 text-slate-600 mb-1" />
              <span className="text-[10px]">No image</span>
            </div>
          </div>

          <div className="space-y-2.5 flex-1">
            <p className="text-xs text-slate-300">
              Upload a clear JPEG or PNG of your character. Grok Imagine will attach this picture automatically before pasting the ChatGPT prompt.
            </p>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingImage}
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition cursor-pointer flex items-center gap-2"
              >
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                <span>{uploadingImage ? 'Uploading…' : 'Choose New Picture'}</span>
              </button>
            </div>
            {imageMsg && (
              <p
                className={`text-[11px] font-medium ${
                  imageMsg.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {imageMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Card 3: Accounts & Grok Video Settings */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              Channel Accounts & Logins
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">
              Each channel operates its own browser profile. Sign in once per platform, and the browser remembers it.
            </p>
          </div>
          <button
            type="button"
            disabled={accountBusy || runBusy}
            onClick={() => startAccountOp(`/api/channels/${channelId}/accounts/check`)}
            className="shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] font-bold text-slate-300 rounded-lg border border-slate-700 transition cursor-pointer disabled:cursor-not-allowed"
          >
            Check logins
          </button>
        </div>

        <div className="space-y-2.5">
          {(accounts?.sites || []).map((site: any) => (
            <div
              key={site.key}
              className={`bg-slate-950/60 border border-slate-800 rounded-xl ${
                site.key === 'grok' ? 'p-3.5 space-y-3' : 'px-3.5 py-2.5'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-200 w-24 text-xs">{site.name}</span>
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
                    <span className="text-[10px] text-slate-500">{new Date(site.checkedAt).toLocaleTimeString()}</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={accountBusy || runBusy}
                  onClick={() => {
                    if (window.confirm(`Switch the ${site.name} account for ${channel?.name}?`)) {
                      startAccountOp(`/api/channels/${channelId}/accounts/${site.key}/switch`);
                    }
                  }}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-[11px] font-bold rounded-lg transition cursor-pointer disabled:cursor-not-allowed"
                >
                  Switch account
                </button>
              </div>

              {/* In the Grok item: Video options dropdowns */}
              {site.key === 'grok' && (
                <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-200">Grok Video Settings</span>
                      <p className="text-[10px] text-slate-400">Resolution & length applied during generation</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                      <span className="font-medium text-slate-300">Quality:</span>
                      <select
                        value={channel?.grok_resolution || '720p'}
                        onChange={(e) => handleGrokChange({ grok_resolution: e.target.value as any })}
                        className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:border-amber-400 focus:outline-none cursor-pointer"
                      >
                        <option value="720p">720p (HD)</option>
                        <option value="480p">480p (SD)</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                      <span className="font-medium text-slate-300">Length:</span>
                      <select
                        value={channel?.grok_duration || 15}
                        onChange={(e) => handleGrokChange({ grok_duration: Number(e.target.value) as any })}
                        className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:border-amber-400 focus:outline-none cursor-pointer"
                      >
                        <option value={15}>15s (Long)</option>
                        <option value={10}>10s (Medium)</option>
                        <option value={6}>6s (Short)</option>
                      </select>
                    </label>
                    {grokSavedMsg && (
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {grokSavedMsg}
                      </span>
                    )}
                  </div>
                </div>
              )}
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
              {accounts.op.state === 'error' && <strong>Failed — </strong>}
              {accounts.op.step}
            </span>
            {accountBusy && (
              <button
                type="button"
                onClick={() => safeFetchJson(`/api/channels/${channelId}/accounts/cancel`, { method: 'POST' }).catch(() => {})}
                className="ml-auto shrink-0 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {/* Card 4: ChatGPT Master Prompt Chat */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-400" />
              ChatGPT Master Prompt Chat
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              The automated run navigates directly to this chat and types "next" to create the next episode script.
            </p>
          </div>
        </div>

        <div className="space-y-3 bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              ChatGPT Conversation URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={chatGptUrlInput}
                onChange={(e) => setChatGptUrlInput(e.target.value)}
                placeholder="https://chatgpt.com/c/..."
                className="flex-1 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveChatGptUrl}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl border border-slate-700 transition cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                disabled={isDetectingChatGpt}
                onClick={handleDetectChatGptUrl}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{isDetectingChatGpt ? 'Searching…' : 'Auto-Detect from Sidebar'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Chat Name in Sidebar (Optional)
              </label>
              <input
                type="text"
                value={chatGptNameInput}
                onChange={(e) => setChatGptNameInput(e.target.value)}
                placeholder="e.g. Create Mr Apple Videos"
                className="w-full bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Hashtag Hint (e.g. #MrApple)
              </label>
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                placeholder="#MyCharacter"
                className="w-full bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none"
              />
            </div>
          </div>

          {chatGptMsg && (
            <p
              className={`text-[11px] font-medium pt-1 ${
                chatGptMsg.type === 'success' ? 'text-emerald-400' : chatGptMsg.type === 'error' ? 'text-rose-400' : 'text-sky-300'
              }`}
            >
              {chatGptMsg.text}
            </p>
          )}
        </div>
      </div>

      {/* Card 5: Where to Post */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-400" />
            Where to Post Each Video
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Choose which platforms receive the published video once generation and safety checks complete.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="flex items-center justify-between p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700">
            <div>
              <span className="font-semibold text-slate-200 block">TikTok Studio</span>
              <span className="text-[11px] text-slate-400">Post directly to TikTok account</span>
            </div>
            <input
              type="checkbox"
              checked={channel?.post_tiktok ?? true}
              onChange={(e) => patchChannel({ post_tiktok: e.target.checked })}
              className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400"
            />
          </label>

          <label className="flex items-center justify-between p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700">
            <div>
              <span className="font-semibold text-slate-200 block">YouTube Shorts</span>
              <span className="text-[11px] text-slate-400">Post Publicly to YouTube channel</span>
            </div>
            <input
              type="checkbox"
              checked={channel?.post_youtube ?? true}
              onChange={(e) => patchChannel({ post_youtube: e.target.checked })}
              className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400"
            />
          </label>
        </div>

        {channel?.post_youtube && (
          <div className="pt-2">
            <label className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl text-xs cursor-pointer">
              <div>
                <span className="font-semibold text-slate-300 block">YouTube Made for Kids</span>
                <span className="text-[11px] text-slate-500">Sets the required children's content flag</span>
              </div>
              <input
                type="checkbox"
                checked={channel?.youtube_made_for_kids ?? true}
                onChange={(e) => patchChannel({ youtube_made_for_kids: e.target.checked })}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400"
              />
            </label>
          </div>
        )}
      </div>

      {/* Card 6: Daily Automatic Posting Schedule */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Daily Automatic Schedule
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Automatically wakes up the channel to produce and upload at your chosen daily times.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={channel?.schedule_enabled ?? false}
              onChange={(e) => handleSaveSchedule(e.target.checked, scheduleTimes)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
          </label>
        </div>

        <div className="space-y-4 bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-slate-300 font-semibold">Videos per day:</span>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    changeScheduleCount(n);
                    if (channel?.schedule_enabled) {
                      const nextTimes = [...scheduleTimes];
                      while (nextTimes.length < n) nextTimes.push('12:00');
                      handleSaveSchedule(true, nextTimes.slice(0, n));
                    }
                  }}
                  className={`w-7 h-7 rounded-lg font-bold text-xs transition cursor-pointer ${
                    scheduleTimes.length === n
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
            {scheduleTimes.map((time, idx) => (
              <div key={idx} className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                <span className="text-[10px] text-slate-500 font-mono">#{idx + 1}</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    const next = [...scheduleTimes];
                    next[idx] = e.target.value;
                    setScheduleTimes(next);
                    if (channel?.schedule_enabled) handleSaveSchedule(true, next);
                  }}
                  className="bg-slate-950 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:outline-none w-full"
                />
              </div>
            ))}
          </div>

          {scheduleMsg && (
            <p
              className={`text-[11px] font-medium pt-1 ${
                scheduleMsg.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {scheduleMsg.text}
            </p>
          )}

          {scheduleConflicts.length > 0 && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/60 text-amber-300 text-xs mt-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Concurrent schedule: </span>
                {scheduleConflicts.map((c, i) => (
                  <span key={i}>
                    {c.time} runs at the same time as <strong>{c.channelName}</strong>
                    {i < scheduleConflicts.length - 1 ? '; ' : '.'}
                  </span>
                ))}
                <span className="text-amber-400/80 block mt-0.5">
                  Both channels will run parallel in separate Chrome windows. Grok video generation is throttled automatically to prevent rate limits.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChannelPage;
