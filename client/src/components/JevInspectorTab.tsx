import React from 'react';
import { Cpu, CheckCircle2, Clock, DollarSign, Filter, Sparkles, AlertCircle } from 'lucide-react';

interface JevInspectorTabProps {
  decisions: any[];
}

export const JevInspectorTab: React.FC<JevInspectorTabProps> = ({ decisions }) => {
  return (
    <div className="space-y-6">
      {/* Header and Explanation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-amber-400" />
            Jev System One Decision Inspector
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            TypeSafe Jev is the production decision-maker. Typed schemas, deterministic distributions, and full auditability.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
          <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block animate-ping" />
          <span>System One Active (~70–120ms latency)</span>
        </div>
      </div>

      {/* Decisions Feed */}
      {decisions.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 max-w-xl mx-auto">
          <Cpu className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-slate-300">No Jev Decisions Recorded Yet</h4>
          <p className="text-xs text-slate-500 mt-1">
            Switch on the studio or commission a pilot to observe real-time structured decisions, candidate rubrics, and probabilities.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {decisions.map((dec) => {
            let optionsObj: Record<string, string> = {};
            let probsObj: Record<string, number> = {};
            try {
              optionsObj = JSON.parse(dec.options_json || '{}');
            } catch (e) {
              optionsObj = {};
            }
            try {
              probsObj = JSON.parse(dec.probabilities_json || '{}');
            } catch (e) {
              probsObj = {};
            }

            return (
              <div
                key={dec.id}
                className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 hover:border-slate-700 transition"
              >
                {/* Decision Meta Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/60 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-amber-400 font-bold">{dec.id}</span>
                    <span className="text-slate-600">•</span>
                    <span className="font-semibold text-slate-300 uppercase tracking-wider">
                      {dec.decision_type.replace(/_/g, ' ')}
                    </span>
                    {dec.job_id && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span className="text-slate-400 font-mono">{dec.job_id}</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-slate-400">
                    <span className="flex items-center gap-1 font-mono text-emerald-400 font-semibold">
                      <Clock className="w-3.5 h-3.5" />
                      {dec.latency_ms}ms
                    </span>
                    <span className="flex items-center gap-1 font-mono text-slate-300">
                      <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                      ${Number(dec.cost_usd || 0).toFixed(5)}
                    </span>
                    <span className="text-slate-500">{new Date(dec.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* State Summary Provided to Jev */}
                <div className="mt-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 text-xs text-slate-300">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    State Assembled for Jev
                  </span>
                  <p className="whitespace-pre-line font-mono text-[11px] text-slate-300/90 leading-relaxed">
                    {dec.state_summary}
                  </p>
                </div>

                {/* Candidate Options Evaluated with Probabilities */}
                <div className="mt-3 space-y-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Candidate Options & Jev Probabilities
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.entries(optionsObj).map(([optKey, optDesc]) => {
                      const isChosen = optKey === dec.chosen_id;
                      const prob = probsObj[optKey] !== undefined ? probsObj[optKey] : (isChosen ? dec.confidence : 0.1);
                      const pct = Math.round(prob * 100);

                      return (
                        <div
                          key={optKey}
                          className={`p-3 rounded-xl border text-xs transition ${
                            isChosen
                              ? 'bg-amber-500/10 border-amber-500/50 text-amber-200 shadow-sm shadow-amber-500/10'
                              : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-bold flex items-center gap-1.5 font-mono">
                              {isChosen && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
                              {optKey}
                            </span>
                            <span className="font-mono font-bold text-[11px]">
                              {pct}%
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-2">
                            {optDesc}
                          </p>
                          {/* Mini probability meter */}
                          <div className="w-full h-1 bg-slate-800 rounded-full mt-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isChosen ? 'bg-amber-400' : 'bg-slate-600'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Outcome Badge */}
                <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Decision Confidence: <strong className="text-slate-200">{(dec.confidence * 100).toFixed(1)}%</strong>
                  </span>
                  <span className="text-amber-400 font-semibold text-[11px]">
                    Outcome: {dec.outcome}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default JevInspectorTab;

