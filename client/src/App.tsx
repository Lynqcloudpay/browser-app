import React, { useEffect, useState } from 'react';
import Header from './components/Header';
import OverviewTab from './components/OverviewTab';
import SeriesCatalogTab from './components/SeriesCatalogTab';
import JevInspectorTab from './components/JevInspectorTab';
import VideoGalleryTab from './components/VideoGalleryTab';
import EconomicsTab from './components/EconomicsTab';
import SettingsTab from './components/SettingsTab';
import QAReviewModal from './components/QAReviewModal';
import VideoPlayerModal from './components/VideoPlayerModal';
import { LayoutDashboard, Layers, Cpu, Film, DollarSign, Settings } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'series' | 'jev' | 'gallery' | 'economics' | 'settings'>('overview');
  const [status, setStatus] = useState<any>({
    settings: {},
    connections: [],
    metrics: { heldJobsCount: 0, activeJobsCount: 0, publishedTodayCount: 0 },
  });
  const [slots, setSlots] = useState<any[]>([]);
  const [series, setSeries] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [economics, setEconomics] = useState<any>({ summary: {}, experiments: [] });

  // Modals state
  const [selectedQAJobId, setSelectedQAJobId] = useState<string | null>(null);
  const [playerModal, setPlayerModal] = useState<{ isOpen: boolean; url: string; title: string; captionsUrl?: string }>({
    isOpen: false,
    url: '',
    title: '',
  });

  const fetchData = async () => {
    try {
      const safeFetchJson = async (url: string) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return {};
          const ct = r.headers.get('content-type') || '';
          if (!ct.includes('application/json')) return {};
          return await r.json();
        } catch (e) {
          return {};
        }
      };

      const [statusRes, slotsRes, seriesRes, jobsRes, decRes, econRes] = await Promise.all([
        safeFetchJson('/api/status'),
        safeFetchJson('/api/slots'),
        safeFetchJson('/api/series'),
        safeFetchJson('/api/jobs'),
        safeFetchJson('/api/decisions'),
        safeFetchJson('/api/economics'),
      ]);

      if (statusRes.settings) setStatus(statusRes);
      if (slotsRes.slots) setSlots(slotsRes.slots);
      if (seriesRes.series) setSeries(seriesRes.series);
      if (jobsRes.jobs) setJobs(jobsRes.jobs);
      if (decRes.decisions) setDecisions(decRes.decisions);
      if (econRes.summary) setEconomics(econRes);
    } catch (err) {
      console.error('Error fetching studio data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleAutomation = async (running: boolean) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_automation_running: running }),
    });
    fetchData();
  };

  const handleTriggerCycle = async () => {
    await fetch('/api/worker/tick', { method: 'POST' });
    fetchData();
  };

  const handleCommissionPilot = async (format: string) => {
    await fetch('/api/series/pilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format }),
    });
    fetchData();
  };

  const handleEvaluateStrategy = async (seriesId: string) => {
    // Triggers strategic evaluation
    await handleTriggerCycle();
    setActiveTab('jev');
  };

  const handleResetCatalog = async () => {
    if (window.confirm('Reset content catalog to completely empty state?')) {
      await fetch('/api/catalog/reset', { method: 'POST' });
      fetchData();
    }
  };

  const handleQAAction = async (jobId: string, action: 'approve_held' | 'discard') => {
    await fetch(`/api/jobs/${jobId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    fetchData();
  };

  const handleSaveSettings = async (updated: any) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    fetchData();
  };

  const handleSaveConnection = async (provider: string, apiKey: string, accountId: string) => {
    await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey, account_identifier: accountId }),
    });
    fetchData();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Header
        settings={status.settings}
        metrics={status.metrics}
        onToggleAutomation={handleToggleAutomation}
        onRefresh={fetchData}
      />

      {/* Main Tab Navigation */}
      <div className="border-b border-slate-800 bg-slate-900/50 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-1 sm:gap-2 overflow-x-auto py-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab('series')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'series'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Content Catalog</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
              {series.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('jev')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'jev'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Jev Inspector</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
              {decisions.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('gallery')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'gallery'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Film className="w-4 h-4" />
            <span>Video Gallery</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
              {jobs.filter((j) => j.video_path).length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('economics')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'economics'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>P&L Economics</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings & APIs</span>
          </button>
        </div>
      </div>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'overview' && (
          <OverviewTab
            status={status}
            slots={slots}
            jobs={jobs}
            onTriggerCycle={handleTriggerCycle}
            onOpenQAReview={(jobId) => setSelectedQAJobId(jobId)}
            onOpenVideoPlayer={(url, title) => setPlayerModal({ isOpen: true, url, title })}
          />
        )}

        {activeTab === 'series' && (
          <SeriesCatalogTab
            series={series}
            onCommissionPilot={handleCommissionPilot}
            onEvaluateStrategy={handleEvaluateStrategy}
            onResetCatalog={handleResetCatalog}
          />
        )}

        {activeTab === 'jev' && (
          <JevInspectorTab decisions={decisions} />
        )}

        {activeTab === 'gallery' && (
          <VideoGalleryTab
            jobs={jobs}
            onOpenVideoPlayer={(url, title) => setPlayerModal({ isOpen: true, url, title })}
            onRefreshJobs={fetchData}
          />
        )}

        {activeTab === 'economics' && (
          <EconomicsTab economics={economics} />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={status.settings}
            connections={status.connections}
            onSaveSettings={handleSaveSettings}
            onSaveConnection={handleSaveConnection}
          />
        )}
      </main>

      {/* Modals */}
      {selectedQAJobId && (
        <QAReviewModal
          jobId={selectedQAJobId}
          onClose={() => setSelectedQAJobId(null)}
          onAction={handleQAAction}
        />
      )}

      {playerModal.isOpen && (
        <VideoPlayerModal
          videoUrl={playerModal.url}
          title={playerModal.title}
          captionsUrl={playerModal.captionsUrl}
          onClose={() => setPlayerModal({ isOpen: false, url: '', title: '' })}
        />
      )}
    </div>
  );
}

export default App;

