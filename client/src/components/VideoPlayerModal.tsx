import React from 'react';
import { X, Film, Download } from 'lucide-react';

interface VideoPlayerModalProps {
  videoUrl: string;
  title: string;
  captionsUrl?: string;
  onClose: () => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  videoUrl,
  title,
  captionsUrl,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="relative bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl flex flex-col items-center">
        {/* Header */}
        <div className="w-full flex items-center justify-between pb-3 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2 truncate pr-2">
            <Film className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold text-white truncate">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 9:16 Player */}
        <div className="w-full aspect-[9/16] bg-black rounded-2xl overflow-hidden my-3 shadow-inner">
          <video
            src={videoUrl}
            controls
            autoPlay
            playsInline
            crossOrigin="anonymous"
            className="w-full h-full object-contain"
          >
            {captionsUrl && (
              <track
                default
                kind="subtitles"
                src={captionsUrl}
                srcLang="en"
                label="English Captions"
              />
            )}
            Your browser does not support HTML5 video.
          </video>
        </div>

        {/* Footer with Download */}
        <div className="w-full flex items-center justify-between pt-2 text-xs text-slate-400">
          <span className="text-[11px]">1080x1920 • 30fps H.264</span>
          <a
            href={videoUrl}
            download={`${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`}
            className="flex items-center gap-1 text-amber-400 hover:underline font-semibold text-[11px]"
          >
            <Download className="w-3.5 h-3.5" /> Download MP4
          </a>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerModal;

