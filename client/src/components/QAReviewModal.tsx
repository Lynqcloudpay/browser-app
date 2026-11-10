import React, { useEffect, useState } from 'react';
import { X, ShieldAlert, CheckCircle2, Trash2, Clock, AlertTriangle } from 'lucide-react';

interface QAReviewModalProps {
  jobId: string;
  onClose: () => void;
  onAction: (jobId: string, action: 'approve_held' | 'discard') => Promise<void>;
}

export const QAReviewModal: React.FC<QAReviewModalProps> = ({
  jobId,
  onClose,
  onAction,
}) => {
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then(async (r) => {
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return null;
        return r.json();
      })
      .then((d) => {
        if (d) setDetails(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching QA review:', err);
        setLoading(false);
      });
  }, [jobId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 text-xs text-slate-300">
          Loading QA details...
        </div>
      </div>
    );
  }

  const job = details?.job;
  const qa = details?.qa;
  let flaggedReasons: any[] = [];
  try {
    flaggedReasons = JSON.parse(qa?.flagged_reasons_json || '[]');
  } catch (e) {
    flaggedReasons = [];
  }

  let sampledFrames: string[] = [];
  try {
    sampledFrames = JSON.parse(qa?.sampled_frames_json || '[]');
  } catch (e) {
    sampledFrames = [];
  }

  const getFrameUrl = (framePath: string) => {
    const parts = framePath.split('storage/');
    return parts.length > 1 ? `/media/${parts[1]}` : framePath;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative space-y-5 my-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-white transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Kids Safety Inspection Hold</h3>
            <p className="text-xs text-slate-400">Job: {job?.id} • Concept: "{job?.concept_title}"</p>
          </div>
        </div>

        {/* Reason Alert */}
        <div className="bg-rose-950/50 border border-rose-500/40 rounded-xl p-4 text-xs text-rose-200 space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>Inspection Flagged Reason</span>
          </div>
          <p className="font-mono text-xs leading-relaxed">
            {job?.hold_reason || 'Safety threshold not satisfied.'}
          </p>
          <span className="text-[11px] text-rose-400 font-semibold block">
            Exact Video Timestamp: {job?.hold_timestamp_sec} seconds
          </span>
        </div>

        {/* Script & Narration Snippet */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
            Audio Script Transcript
          </span>
          <p className="italic text-slate-300 leading-relaxed font-sans">
            "{job?.script_text}"
          </p>
        </div>

        {/* Sampled Frames */}
        {sampledFrames.length > 0 && (
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Sampled Video Frames ({sampledFrames.length})
            </span>
            <div className="grid grid-cols-4 gap-2">
              {sampledFrames.map((fPath, idx) => (
                <div key={idx} className="aspect-[9/16] bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
                  <img
                    src={getFrameUrl(fPath)}
                    alt={`Frame ${idx + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            onClick={async () => {
              await onAction(job.id, 'discard');
              onClose();
            }}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-rose-400 rounded-xl border border-slate-700 transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Discard Job</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl transition"
            >
              Close
            </button>
            <button
              onClick={async () => {
                await onAction(job.id, 'approve_held');
                onClose();
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-600/30"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Adult Override & Publish</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QAReviewModal;

