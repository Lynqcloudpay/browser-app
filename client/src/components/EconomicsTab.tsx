import React, { useState } from 'react';
import { DollarSign, TrendingUp, Compass, Award, BarChart3, HelpCircle, CheckCircle2, ShieldCheck, Download, Plus, Sparkles, Video } from 'lucide-react';
import { safeFetchJson } from '../utils/api';

interface EconomicsTabProps {
  economics: any;
  onRefresh?: () => void;
}

export const EconomicsTab: React.FC<EconomicsTabProps> = ({ economics, onRefresh }) => {
  const summary = economics?.summary;
  const experiments = economics?.experiments || [];
  const seriesBreakdown = summary?.seriesBreakdown || [];

  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [selectedSeriesId, setSelectedSeriesId] = useState('');
  const [revenueCategory, setRevenueCategory] = useState('revenue_licensing');
  const [revenueAmount, setRevenueAmount] = useState('');
  const [revenueNotes, setRevenueNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLaunchingCR, setIsLaunchingCR] = useState(false);
  const [crMessage, setCrMessage] = useState('');

  const handleRecordRevenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeriesId || !revenueAmount) return;
    setIsSubmitting(true);
    try {
      await fetch('/api/economics/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesId: selectedSeriesId,
          category: revenueCategory,
          amountUsd: revenueAmount,
          notes: revenueNotes,
        }),
      });
      setShowRevenueModal(false);
      setRevenueAmount('');
      setRevenueNotes('');
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLaunchCreatorRewards = async () => {
    setIsLaunchingCR(true);
    setCrMessage('');
    try {
      const data = await safeFetchJson('/api/series/creator-rewards-pilot', { method: 'POST' });
      if (data.success) {
        setCrMessage(`Creator Rewards Long-Form Episode Commissioned: "${data.title}" (Duration target: >60s). Budget locked upfront.`);
      } else {
        setCrMessage(`Unable to launch: ${data.error || 'Unknown error'}`);
      }
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setCrMessage(`Error: ${err.message}`);
    } finally {
      setIsLaunchingCR(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            Studio Economics & Monetization Discovery
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Discover kids' series that generate measurable earnings after production costs. Itemized P&L, verifiable payouts, and weekly revenue experiments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/economics/export"
            download="KindredStudio_Financial_Ledger.csv"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Export Ledger (CSV)</span>
          </a>
          <button
            onClick={() => setShowRevenueModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition shadow-lg shadow-emerald-600/20"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Confirmed Revenue</span>
          </button>
        </div>
      </div>

      {crMessage && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{crMessage}</span>
        </div>
      )}

      {/* High-Level P&L Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Production Spend</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold font-kids text-rose-400">
              ${Number(summary?.totalSpendUsd || 0).toFixed(2)}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Writing, decisions, rendering</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Confirmed Gross Revenue</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold font-kids text-emerald-400">
              ${Number(summary?.totalGrossRevenueUsd || 0).toFixed(2)}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Creator Rewards & Licensing</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Net Contribution</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-2xl font-bold font-kids ${Number(summary?.totalNetContributionUsd || 0) >= 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
              ${Number(summary?.totalNetContributionUsd || 0).toFixed(2)}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">After all production costs</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Avg Cost / Video</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold font-kids text-amber-400">
              ${Number(summary?.avgCostPerPublishedVideo || 0.18).toFixed(2)}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Jev latency: {summary?.avgJevDecisionLatencyMs || 85}ms
          </span>
        </div>
      </div>

      {/* Series Itemized P&L Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-400" />
            Series Itemized P&L Breakdown
          </h3>
          <button
            onClick={handleLaunchCreatorRewards}
            disabled={isLaunchingCR || seriesBreakdown.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-md shadow-indigo-600/20 disabled:opacity-50"
          >
            <Video className="w-3.5 h-3.5" />
            <span>{isLaunchingCR ? 'Evaluating with Jev...' : 'Launch Creator Rewards Pilot (>60s)'}</span>
          </button>
        </div>

        {seriesBreakdown.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No active series to display yet. Originate your first series pilot to begin ledger tracking.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Series</th>
                  <th className="py-2.5 px-3">Published</th>
                  <th className="py-2.5 px-3">Writing</th>
                  <th className="py-2.5 px-3">Jev Decisions</th>
                  <th className="py-2.5 px-3">Grok Renders</th>
                  <th className="py-2.5 px-3">Total Cost</th>
                  <th className="py-2.5 px-3">Creator Rewards</th>
                  <th className="py-2.5 px-3">Licensing</th>
                  <th className="py-2.5 px-3">Net Profit</th>
                  <th className="py-2.5 px-3">Data Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {seriesBreakdown.map((row: any) => (
                  <tr key={row.seriesId} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 px-3 font-sans font-bold text-white">
                      {row.title}
                      <span className="block text-[10px] font-normal text-slate-500 capitalize">{row.format}</span>
                    </td>
                    <td className="py-3 px-3">{row.totalPublished}</td>
                    <td className="py-3 px-3">${row.writingCostUsd.toFixed(3)}</td>
                    <td className="py-3 px-3">${row.jevCostUsd.toFixed(4)}</td>
                    <td className="py-3 px-3">${row.renderingCostUsd.toFixed(2)}</td>
                    <td className="py-3 px-3 font-bold text-rose-300">${row.totalCostUsd.toFixed(2)}</td>
                    <td className="py-3 px-3">${row.creatorRewardsConfirmedUsd.toFixed(2)}</td>
                    <td className="py-3 px-3">${row.licensingConfirmedUsd.toFixed(2)}</td>
                    <td className={`py-3 px-3 font-bold ${row.netContributionUsd >= 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      ${row.netContributionUsd.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        row.revenueStatus === 'confirmed'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {row.revenueStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Weekly 3 Kids-Only Monetization Experiments */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-amber-400" />
              Weekly Kids-Only Monetization Experiments (Week 46)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Targeted hypothesis, route to revenue, bounded test, cost ceiling, and success metrics. No unapproved prospect contacting.
            </p>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
            3 Active Hypotheses
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          {experiments.map((exp: any) => (
            <div
              key={exp.id}
              className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3"
            >
              <div>
                <span className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider block mb-1">
                  {exp.week_number} • Cost Cap: ${exp.cost_ceiling_usd}
                </span>
                <h4 className="text-sm font-bold text-white leading-snug">{exp.title}</h4>

                <div className="mt-2.5 space-y-2 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Audience Need:</span>
                    <p className="text-slate-300 text-[11px] leading-relaxed">{exp.audience_need}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-400 uppercase font-bold block">Route to Revenue:</span>
                    <p className="text-emerald-300/90 text-[11px] leading-relaxed">{exp.route_to_revenue}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Test Plan:</span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">{exp.test_plan}</p>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-800/80 text-[11px]">
                <span className="text-slate-400 block font-semibold">Success Metric:</span>
                <span className="text-slate-200">{exp.success_metric}</span>
                <div className="mt-2 text-[10px] text-amber-400/90 font-mono italic">
                  {exp.jev_verdict || exp.jevVerdict}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Record Revenue Modal */}
      {showRevenueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleRecordRevenue}
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                Record Confirmed Revenue Payout
              </h4>
              <button
                type="button"
                onClick={() => setShowRevenueModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Select Series</label>
              <select
                value={selectedSeriesId}
                onChange={(e) => setSelectedSeriesId(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
              >
                <option value="">-- Choose Series --</option>
                {seriesBreakdown.map((s: any) => (
                  <option key={s.seriesId} value={s.seriesId}>
                    {s.title} ({s.format})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Revenue Stream</label>
              <select
                value={revenueCategory}
                onChange={(e) => setRevenueCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
              >
                <option value="revenue_licensing">Adult Educational Licensing Deal</option>
                <option value="revenue_creator_rewards">TikTok Creator Rewards Payout</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Confirmed Amount ($ USD)</label>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 50.00"
                value={revenueAmount}
                onChange={(e) => setRevenueAmount(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Notes / License Identifier</label>
              <input
                type="text"
                placeholder="e.g. School curriculum evaluation license"
                value={revenueNotes}
                onChange={(e) => setRevenueNotes(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl p-2.5 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRevenueModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white rounded-xl transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
              >
                {isSubmitting ? 'Recording...' : 'Confirm & Log Revenue'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default EconomicsTab;
