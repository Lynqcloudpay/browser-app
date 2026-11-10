import React from 'react';
import { Sparkles, Power, Clock, ShieldAlert, DollarSign, Play, Pause } from 'lucide-react';

interface HeaderProps {
  settings: any;
  metrics: {
    heldJobsCount: number;
    activeJobsCount: number;
    publishedTodayCount: number;
  };
  onToggleAutomation: (running: boolean) => void;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  metrics,
  onToggleAutomation,
  onRefresh,
}) => {
  const isRunning = settings?.is_automation_running === 1;
  const isBudgetPaused = settings?.is_paused_budget === 1;
  const spentToday = Number(settings?.spent_today_usd || 0).toFixed(2);
  const budgetCap = Number(settings?.daily_budget_usd || 15).toFixed(2);
  const percentBudget = Math.min(100, Math.round((Number(spentToday) / Number(budgetCap)) * 100));

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40 px-4 py-3 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Brand & Subtitle */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950 font-bold">
            <Sparkles className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-kids tracking-wide text-white">KindredStudio</h1>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30">
                Jev Production Loop
              </span>
              {settings?.demo_mode === 1 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                  Demo Sandbox
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Autonomous Children’s Entertainment & Education Discovery • Operator: {settings?.operator_name || 'Adult Creator'}
            </p>
          </div>
        </div>

        {/* Studio Controls: Master Switch, Budget Cap, Alerts */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {/* Timezone & Posts Target */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{settings?.timezone || 'America/New_York'}</span>
            <span className="text-slate-600">•</span>
            <span className="text-amber-400 font-semibold">{settings?.daily_posts_target || 3} posts/day target</span>
          </div>

          {/* Daily Budget Progress */}
          <div className="flex items-center gap-2 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <div className="flex flex-col text-left">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Today's Budget</span>
              <span className="text-xs font-bold text-slate-200">
                ${spentToday} <span className="text-slate-500">/ ${budgetCap}</span>
              </span>
            </div>
            <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden ml-1">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  percentBudget > 85 ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${percentBudget}%` }}
              />
            </div>
          </div>

          {/* Held for QA alert button */}
          {metrics.heldJobsCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/40 animate-pulse">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>{metrics.heldJobsCount} Safety Hold</span>
            </div>
          )}

          {/* Master Automation Switch using native HTML switch attribute with accessible fallback */}
          <div className="flex items-center gap-2.5 bg-slate-800/90 px-3.5 py-1.5 rounded-xl border border-slate-700">
            <label
              htmlFor="master-automation-switch"
              className="text-xs font-semibold text-slate-200 cursor-pointer flex items-center gap-1.5"
            >
              {isRunning ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  Studio Active
                </span>
              ) : isBudgetPaused ? (
                <span className="text-rose-400">Budget Paused</span>
              ) : (
                <span className="text-slate-400">Studio Standby</span>
              )}
            </label>

            <div className="relative inline-flex items-center cursor-pointer">
              <input
                id="master-automation-switch"
                type="checkbox"
                // Progressive enhancement: switch attribute
                {...({ switch: '' } as any)}
                role="switch"
                aria-checked={isRunning}
                checked={isRunning}
                onChange={(e) => onToggleAutomation(e.target.checked)}
                className="w-11 h-6 bg-slate-700 rounded-full cursor-pointer accent-amber-500 peer"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;

