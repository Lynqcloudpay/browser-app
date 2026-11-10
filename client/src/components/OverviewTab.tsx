import React from 'react';
import { Calendar, CheckCircle2, Clock, PlayCircle, AlertTriangle, ArrowRight, Zap, RefreshCw, Film, Sparkles, ExternalLink } from 'lucide-react';

interface OverviewTabProps {
  status: any;
  slots: any[];
  jobs: any[];
  onTriggerCycle: () => void;
  onOpenQAReview: (jobId: string) => void;
  onOpenVideoPlayer: (videoUrl: string, title: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  status,
  slots,
  jobs,
  onTriggerCycle,
  onOpenQAReview,
  onOpenVideoPlayer,
}) => {
  const activeJob = jobs.find((j) => ['planned', 'scripting', 'rendering', 'qa_inspection', 'ready_to_publish'].includes(j.state));
  const heldJobs = jobs.filter((j) => j.state === 'held_for_review');

  const getSlotStatusBadge = (slot: any) => {
    switch (slot.status) {
      case 'published':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Published</span>;
      case 'ready':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Scheduled</span>;
      case 'reserved':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1 animate-pulse"><Zap className="w-3.5 h-3.5" /> Producing</span>;
      case 'missed':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/60 text-slate-400 border border-slate-600">Past Slot</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">Open Slot</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top QA Safety Hold Alert Banner if any */}
      {heldJobs.length > 0 && (
        <div className="bg-rose-950/40 border border-rose-500/50 rounded-2xl p-4 sm:p-5 text-rose-200 shadow-xl shadow-rose-950/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-500/20 rounded-xl text-rose-400 mt-0.5 sm:mt-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-rose-100 flex items-center gap-2">
                  Kids Safety QA Hold ({heldJobs.length} {heldJobs.length === 1 ? 'Job' : 'Jobs'})
                </h3>
                <p className="text-xs sm:text-sm text-rose-300/90 mt-0.5">
                  Automated inspection flagged potential safety issues. Video held from publication pending adult review.
                </p>
                <div className="mt-2 text-xs text-rose-300 font-mono bg-rose-950/60 px-3 py-1.5 rounded-lg border border-rose-800/40 inline-block">
                  Timestamp: {heldJobs[0].hold_timestamp_sec}s • Reason: {heldJobs[0].hold_reason}
                </div>
              </div>
            </div>
            <button
              onClick={() => onOpenQAReview(heldJobs[0].id)}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-rose-600/30 flex items-center gap-1.5 shrink-0 self-end sm:self-center"
            >
              Inspect & Resolve <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Posts Target</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-kids text-amber-400">{status.metrics?.publishedTodayCount || 0}</span>
            <span className="text-sm text-slate-500">/ {status.settings?.daily_posts_target || 3} today</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Spaced throughout day</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Decision Latency</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-kids text-emerald-400">~85ms</span>
            <span className="text-sm text-slate-500">Jev System One</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Deterministic typed schemas</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Pipeline Jobs</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-kids text-indigo-400">{status.metrics?.activeJobsCount || 0}</span>
            <span className="text-sm text-slate-500">active</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Concurrency lock active</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">AI Content Label</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-lg font-bold font-kids text-sky-400">isAiGenerated: true</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">TikTok policy compliant</span>
        </div>
      </div>

      {/* Main Grid: Active Production Job + Schedule Slots */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Production Job in Jev Decision Loop */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm sm:text-base">Live Production Pipeline</h3>
                  <p className="text-xs text-slate-400">Jev Decision Loop & Asset Factory</p>
                </div>
              </div>
              <button
                onClick={onTriggerCycle}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                <span>Run Cycle Tick</span>
              </button>
            </div>

            {activeJob ? (
              <div className="mt-5 space-y-4">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                        Active Job: {activeJob.id}
                      </span>
                      <h4 className="text-base font-bold text-white mt-0.5">{activeJob.concept_title}</h4>
                      <p className="text-xs text-slate-400 mt-1 italic">"{activeJob.hook}"</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      {activeJob.state}
                    </span>
                  </div>

                  {/* Stage Progress Pills */}
                  <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-800/60 text-center">
                    <div className={`p-2 rounded-lg text-xs font-semibold ${['planned', 'scripting', 'rendering', 'qa_inspection', 'ready_to_publish'].includes(activeJob.state) ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-900 text-slate-500'}`}>
                      1. Scripting
                    </div>
                    <div className={`p-2 rounded-lg text-xs font-semibold ${['rendering', 'qa_inspection', 'ready_to_publish'].includes(activeJob.state) ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-900 text-slate-500'}`}>
                      2. Grok Render
                    </div>
                    <div className={`p-2 rounded-lg text-xs font-semibold ${['qa_inspection', 'ready_to_publish'].includes(activeJob.state) ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-900 text-slate-500'}`}>
                      3. Kids QA
                    </div>
                    <div className={`p-2 rounded-lg text-xs font-semibold ${activeJob.state === 'ready_to_publish' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-500'}`}>
                      4. Publisher
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-400 flex items-center justify-between px-1">
                  <span>Reserved Spend: ${Number(activeJob.spend_reserved_usd || 0).toFixed(2)}</span>
                  <span>Estimated Total: ${Number(activeJob.estimated_cost_usd || 0).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-8 mb-6 text-center py-8 bg-slate-950/40 border border-dashed border-slate-800 rounded-xl">
                <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-slate-300">Pipeline Ready for Next Slot</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                  Automation is standing by. When the next publishing slot approaches or when triggered, Jev will commission and render the next episode.
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
            <span>Anti-flood Spacing: ≥ 3.0 Hours between posts</span>
            <span>Developmental Age Band: {status.settings?.age_band || '5-7'}</span>
          </div>
        </div>

        {/* Daily Publishing Schedule Slots */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-slate-100 text-sm sm:text-base">Daily Schedule Slots</h3>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {slots.length} Slots
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {slots.map((slot, idx) => (
                <div
                  key={slot.id || idx}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3 hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-800/80 flex flex-col items-center justify-center text-slate-300 font-bold">
                      <span className="text-[10px] text-slate-500 uppercase">Slot</span>
                      <span className="text-xs">{slot.target_time}</span>
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-slate-200">
                        {slot.concept_title || (slot.assigned_job_id ? `Job ${slot.assigned_job_id}` : 'Open Discovery Slot')}
                      </h5>
                      <span className="text-[11px] text-slate-500">
                        Target: {slot.target_time} ({status.settings?.timezone || 'EST'})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {getSlotStatusBadge(slot)}
                    {slot.video_path && (
                      <button
                        onClick={() => onOpenVideoPlayer(slot.video_path, slot.concept_title)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                        title="Watch Video"
                      >
                        <PlayCircle className="w-4 h-4 text-amber-400" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 text-center">
            Timezone-aware scheduling • Confirmed publication receipts required
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;

