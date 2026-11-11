import { useEffect, useId, useRef } from 'react';
import { Download, X } from 'lucide-react';

interface VideoPlayerModalProps {
  url: string;
  title: string;
  onClose: () => void;
}

export function VideoPlayerModal({ url, title, onClose }: VideoPlayerModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const back = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);

  const fileName = `${title.replace(/[^a-zA-Z0-9]/g, '_') || 'video'}.mp4`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ks-enter w-full max-w-sm rounded-[14px] bg-sheet p-4 shadow-[0_12px_40px_rgba(22,48,43,0.2)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="min-w-0 truncate text-[16px] font-bold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Close player"
            className="shrink-0 rounded-md p-1 text-ink-soft hover:text-ink"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <video src={url} controls autoPlay playsInline className="mt-3 aspect-[9/16] w-full rounded-[10px] bg-ink object-contain">
          Your browser does not support HTML5 video.
        </video>
        <div className="mt-3 flex justify-end">
          <a
            href={url}
            download={fileName}
            className="inline-flex items-center gap-2 rounded-md text-[14px] font-semibold text-ink underline underline-offset-4"
          >
            <Download className="size-4" aria-hidden="true" />
            Download MP4
          </a>
        </div>
      </div>
    </div>
  );
}
