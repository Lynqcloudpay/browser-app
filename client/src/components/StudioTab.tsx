import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Sparkles, Clock, Key, ArrowRight, Image as ImageIcon, Video } from 'lucide-react';
import { safeFetchJson } from '../utils/api';

interface StudioTabProps {
  onSelectChannel: (channelId: number) => void;
}

export const StudioTab: React.FC<StudioTabProps> = ({ onSelectChannel }) => {
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadChannels = async () => {
    try {
      const res = await safeFetchJson('/api/channels');
      if (Array.isArray(res?.channels)) {
        setChannels(res.channels);
      }
    } catch {
      // Server might be reloading
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
    const interval = setInterval(loadChannels, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateChannel = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setErrorMsg('');
    try {
      const res = await safeFetchJson('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (res?.id) {
        setNewName('');
        setShowAddModal(false);
        await loadChannels();
        onSelectChannel(res.id);
      } else {
        setErrorMsg(res?.error || 'Could not create channel.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create channel.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteChannel = async (e: React.MouseEvent, channel: any) => {
    e.stopPropagation();
    if (!window.confirm(`Delete channel "${channel.name}"? Its schedule will stop and its login profile will be archived.`)) {
      return;
    }
    try {
      await safeFetchJson(`/api/channels/${channel.id}`, { method: 'DELETE' });
      await loadChannels();
    } catch (err: any) {
      alert(`Could not delete: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Studio Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Kindred Channel Studio
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage your autonomous creator channels. Each channel has its own dedicated Chrome window, character reference picture, ChatGPT conversation, Grok settings, and posting schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl transition shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Channel</span>
        </button>
      </div>

      {/* Channels Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {channels.map((ch) => {
          const runSt = ch.runStatus || { state: 'idle', step: '' };
          const isBusy = runSt.state === 'running' || runSt.state === 'waiting_login';
          const sites = ch.accounts?.sites || [];

          return (
            <div
              key={ch.id}
              onClick={() => onSelectChannel(ch.id)}
              className="group bg-slate-900/60 hover:bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition flex flex-col justify-between cursor-pointer shadow-lg space-y-4"
            >
              {/* Top row: Name & Delete */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {ch.hasReferenceImage ? (
                      <img
                        src={`/api/channels/${ch.id}/reference-image?t=${encodeURIComponent(ch.updated_at || '')}`}
                        alt={ch.name}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-700 bg-slate-950 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 shrink-0">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-bold text-white text-base group-hover:text-amber-400 transition flex items-center gap-2">
                        {ch.name}
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono font-normal">
                          CH #{ch.id}
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Grok: <span className="text-slate-300 font-semibold">{ch.grok_resolution}</span> • <span className="text-slate-300 font-semibold">{ch.grok_duration}s</span>
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    title="Delete channel"
                    onClick={(e) => handleDeleteChannel(e, ch)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Status Pill */}
                <div className="mt-3.5">
                  <div
                    className={`p-2.5 rounded-xl text-xs flex items-center justify-between ${
                      runSt.state === 'running'
                        ? 'bg-amber-950/40 border border-amber-800/80 text-amber-300 animate-pulse'
                        : runSt.state === 'waiting_login'
                        ? 'bg-sky-950/40 border border-sky-700/80 text-sky-200 animate-pulse'
                        : runSt.state === 'error'
                        ? 'bg-rose-950/40 border border-rose-800/80 text-rose-300'
                        : runSt.state === 'done'
                        ? 'bg-emerald-950/40 border border-emerald-800/80 text-emerald-300'
                        : 'bg-slate-950/50 border border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className="truncate pr-2 font-medium text-[11px]">
                      {runSt.state === 'running' && 'Generating video…'}
                      {runSt.state === 'waiting_login' && 'Sign-in required'}
                      {runSt.state === 'error' && 'Run failed'}
                      {runSt.state === 'done' && 'Ready / Finished'}
                      {runSt.state === 'idle' && 'Idle — Ready to make video'}
                    </span>
                    <span className="w-2 h-2 rounded-full shrink-0 bg-current" />
                  </div>
                </div>

                {/* Account logins dots */}
                <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="text-slate-500">Logins:</span>
                  <div className="flex items-center gap-2">
                    {sites.map((site: any) => (
                      <span
                        key={site.key}
                        title={`${site.name}: ${site.state === 'in' ? 'Signed in' : site.state === 'out' ? 'Signed out' : 'Not checked'}`}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          site.state === 'in'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : site.state === 'out'
                            ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}
                      >
                        {site.name.slice(0, 4)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Schedule preview */}
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" /> Schedule:
                  </span>
                  <span>
                    {ch.schedule_enabled && ch.schedule_times?.length
                      ? `${ch.schedule_times.length} time${ch.schedule_times.length > 1 ? 's' : ''} (${ch.schedule_times.slice(0, 2).join(', ')}${ch.schedule_times.length > 2 ? '…' : ''})`
                      : 'Disabled'}
                  </span>
                </div>
              </div>

              {/* Bottom action: Open Channel */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-amber-400 font-bold group-hover:text-amber-300">
                <span>Configure & Run</span>
                <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition" />
              </div>
            </div>
          );
        })}

        {/* Add Channel Card */}
        <div
          onClick={() => setShowAddModal(true)}
          className="border-2 border-dashed border-slate-800 hover:border-amber-500/50 hover:bg-slate-900/30 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-slate-500 hover:text-amber-400 transition cursor-pointer min-h-[220px]"
        >
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-amber-400">
            <Plus className="w-6 h-6" />
          </div>
          <span className="font-bold text-sm">Add New Channel</span>
          <p className="text-[11px] text-slate-500 text-center max-w-[200px]">
            Creates an independent browser session, character picture, and schedule.
          </p>
        </div>
      </div>

      {/* Add Channel Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-amber-400" />
              Create New Channel
            </h3>
            <p className="text-xs text-slate-400">
              Give your new channel a name (for example, "Wonder Lab", "Baby Lemur Adventures", or "Bedtime Tales"). You can change it anytime.
            </p>

            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Channel Name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Captain Kangaroo Tales"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none"
                />
              </div>

              {errorMsg && (
                <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg p-2.5">
                  {errorMsg}
                </p>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setErrorMsg('');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-xl transition cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  {creating ? 'Creating…' : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudioTab;

