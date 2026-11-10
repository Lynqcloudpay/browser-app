import React, { useState } from 'react';
import { Film, Play, Download, ExternalLink, CheckCircle2, Clock, AlertTriangle, Sparkles, ShieldCheck, FolderOpen, Trash2, HardDrive } from 'lucide-react';

interface VideoGalleryTabProps {
  jobs: any[];
  onOpenVideoPlayer: (videoUrl: string, title: string) => void;
  onRefreshJobs?: () => void;
}

export const VideoGalleryTab: React.FC<VideoGalleryTabProps> = ({
  jobs,
  onOpenVideoPlayer,
  onRefreshJobs,
}) => {
  const [cleaning, setCleaning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const videoJobs = jobs.filter((j) => j.video_path || ['published', 'scheduled', 'ready_to_publish', 'awaiting_action'].includes(j.state));

  const getMediaUrl = (filePath: string) => {
    if (!filePath) return '';
    // Relative to /media
    const parts = filePath.split('storage/');
    return parts.length > 1 ? `/media/${parts[1]}` : filePath;
  };

  const handleOpenFolder = async () => {
    try {
      const res = await fetch('/api/storage/open-videos-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMsg('Opened storage folder in Finder!');
        setTimeout(() => setActionMsg(null), 3500);
      }
    } catch {
      setActionMsg('Finder opened or check /Volumes/Mel\'s SSD/browser app/storage/videos');
      setTimeout(() => setActionMsg(null), 3500);
    }
  };

  const handleCleanTemp = async () => {
    if (!window.confirm('Delete intermediate shot clips and temporary frames to free up disk space? Final assembled videos will be preserved.')) return;
    setCleaning(true);
    try {
      const res = await fetch('/api/storage/clean-temp-files', { method: 'POST' });
      const data = await res.json();
      setActionMsg(data.message || 'Cleaned temporary files!');
      setTimeout(() => setActionMsg(null), 4000);
      if (onRefreshJobs) onRefreshJobs();
    } catch (err: any) {
      setActionMsg('Failed to clean: ' + err.message);
      setTimeout(() => setActionMsg(null), 4000);
    } finally {
      setCleaning(false);
    }
  };

  const handleDeleteVideo = async (job: any) => {
    if (!window.confirm(`Delete "${job.concept_title || 'this video'}" from disk to free up space?`)) return;
    try {
      const fileName = job.video_path ? job.video_path.split('/').pop() : `final_${job.id}.mp4`;
      const res = await fetch(`/api/storage/videos/${fileName}`, { method: 'DELETE' });
      const data = await res.json();
      setActionMsg(data.message || `Deleted ${fileName}`);
      setTimeout(() => setActionMsg(null), 3000);
      if (onRefreshJobs) onRefreshJobs();
    } catch (err: any) {
      setActionMsg('Delete error: ' + err.message);
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Film className="w-5 h-5 text-amber-400" />
            Finished Video Gallery & Publication Receipts
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Original children's entertainment & education. Clean audio, 9:16 vertical storytelling, and AI transparency disclosure.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleOpenFolder}
            className="text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition"
            title="Open dedicated storage folder in macOS Finder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Open Videos Folder</span>
          </button>
          <button
            onClick={handleCleanTemp}
            disabled={cleaning}
            className="text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition disabled:opacity-50"
            title="Clean intermediate shot clips to free up disk space"
          >
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
            <span>{cleaning ? 'Cleaning...' : 'Free Up Disk Space'}</span>
          </button>
        </div>
      </div>

      {/* Storage Folder Path Info Banner */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3 px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px] overflow-hidden truncate">
          <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-slate-500">Dedicated Video Folder:</span>
          <span className="text-slate-200 select-all font-semibold">/Volumes/Mel's SSD/browser app/storage/videos</span>
        </div>
        {actionMsg && (
          <div className="text-emerald-400 font-medium text-[11px] animate-pulse">
            {actionMsg}
          </div>
        )}
      </div>

      {videoJobs.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 max-w-xl mx-auto">
          <Film className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-slate-300">No Rendered Videos Yet</h4>
          <p className="text-xs text-slate-500 mt-1">
            Once a job completes the Jev decision loop, Grok Imagine render, and Kids Safety QA check, finished vertical MP4s will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {videoJobs.map((job) => {
            const videoWebUrl = getMediaUrl(job.video_path);
            const thumbWebUrl = getMediaUrl(job.thumbnail_path);

            return (
              <div
                key={job.id}
                className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between hover:border-slate-700 transition shadow-lg shadow-slate-950/40 group"
              >
                <div>
                  {/* Vertical 9:16 Thumbnail Container with Play Overlay */}
                  <div className="relative aspect-[9/16] bg-slate-950 flex items-center justify-center overflow-hidden">
                    {job.thumbnail_path ? (
                      <img
                        src={thumbWebUrl}
                        alt={job.concept_title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="text-slate-600 flex flex-col items-center">
                        <Film className="w-10 h-10 mb-2" />
                        <span className="text-xs">9:16 Video</span>
                      </div>
                    )}

                    {/* Dark gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-slate-950/40" />

                    {/* Play Button Overlay */}
                    <button
                      onClick={() => onOpenVideoPlayer(videoWebUrl, job.concept_title)}
                      className="absolute inset-0 flex items-center justify-center group-hover:scale-110 transition"
                      aria-label="Play Video"
                    >
                      <div className="w-12 h-12 rounded-full bg-amber-500/90 text-slate-950 flex items-center justify-center shadow-xl shadow-amber-500/40">
                        <Play className="w-6 h-6 fill-slate-950 ml-0.5" />
                      </div>
                    </button>

                    {/* Top Badges: Format & AI Label */}
                    <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between text-[10px] font-bold">
                      <span className="px-2 py-0.5 rounded-full bg-slate-900/80 backdrop-blur text-amber-400 border border-slate-700 uppercase">
                        {job.format}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/20 backdrop-blur text-sky-300 border border-sky-500/40">
                        AI Label Disclosed
                      </span>
                    </div>

                    {/* Bottom Duration Badge */}
                    <div className="absolute bottom-2.5 right-2.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-900/90 text-slate-200">
                      {Math.round(job.duration_seconds || 18)}s
                    </div>
                  </div>

                  {/* Video Meta Info */}
                  <div className="p-4 space-y-2">
                    <h4 className="text-sm font-bold text-white line-clamp-1">{job.concept_title}</h4>
                    <p className="text-xs text-slate-400 line-clamp-2 italic">
                      "{job.hook}"
                    </p>

                    {/* Publication Status & Buffer Receipt */}
                    <div className="pt-2 border-t border-slate-800/80 text-xs">
                      {job.state === 'published' ? (
                        <div className="flex items-center justify-between text-emerald-400">
                          <span className="flex items-center gap-1 font-semibold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Published
                          </span>
                          {job.tiktok_share_url && (
                            <a
                              href={job.tiktok_share_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
                            >
                              TikTok <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ) : job.state === 'scheduled' ? (
                        <div className="flex items-center gap-1 text-indigo-400 font-semibold text-[11px]">
                          <Clock className="w-3.5 h-3.5" /> Scheduled via Buffer
                        </div>
                      ) : job.state === 'awaiting_action' ? (
                        <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-[11px]">
                          <span className="font-bold flex items-center gap-1 mb-0.5">
                            <AlertTriangle className="w-3 h-3" /> Awaiting Action
                          </span>
                          {job.awaiting_action_notes || 'Requires audio clearance inside TikTok app.'}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 capitalize">State: {job.state}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Export / Download MP4 Action & Delete to free space */}
                <div className="p-4 pt-0 flex items-center gap-2">
                  <a
                    href={videoWebUrl}
                    download={`KindredKids_${job.id}.mp4`}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>Export MP4</span>
                  </a>
                  <button
                    onClick={() => handleDeleteVideo(job)}
                    className="p-2 bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-xl border border-slate-700/80 hover:border-red-500/30 transition"
                    title="Delete video file to free space"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default VideoGalleryTab;

