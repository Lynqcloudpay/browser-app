import React, { useState } from 'react';
import { Layers, Plus, Sparkles, Palette, Volume2, BookOpen, Activity, AlertCircle } from 'lucide-react';

interface SeriesCatalogTabProps {
  series: any[];
  onCommissionPilot: (format: string) => void;
  onEvaluateStrategy: (seriesId: string) => void;
  onResetCatalog: () => void;
}

export const SeriesCatalogTab: React.FC<SeriesCatalogTabProps> = ({
  series,
  onCommissionPilot,
  onEvaluateStrategy,
  onResetCatalog,
}) => {
  const [selectedFormat, setSelectedFormat] = useState('visual_puzzle');
  const [isCommissioning, setIsCommissioning] = useState(false);

  const handleCommission = async () => {
    setIsCommissioning(true);
    await onCommissionPilot(selectedFormat);
    setIsCommissioning(false);
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Commission Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            Original Children's Content Catalog
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Original intellectual property created inside this project. Clean sheets, verifiable science, and kid-safe continuity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-500"
          >
            <option value="visual_puzzle">Visual Puzzle (e.g. Paper Dragon)</option>
            <option value="simple_science">Simple Science (e.g. Bubble Sphere)</option>
            <option value="kindness_story">Kindness Story (e.g. Snail Crossing)</option>
          </select>
          <button
            onClick={handleCommission}
            disabled={isCommissioning}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold transition shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isCommissioning ? 'Jev Origination...' : 'Originate Pilot Series'}</span>
          </button>
        </div>
      </div>

      {/* Series Cards or Clean Cold-Start Banner */}
      {series.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-8 max-w-2xl mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-4">
            <Sparkles className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-100 font-kids">Content Catalog Empty (Cold Start Ready)</h3>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Starting with a clean slate: no previous franchises, borrowed brands, or legacy prompt history.
            When you switch the studio on or originate a pilot, Jev evaluates original format templates, creates the design sheet, and establishes repeatable continuity.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => onCommissionPilot('visual_puzzle')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl border border-slate-700 transition"
            >
              Originate Visual Puzzle Series
            </button>
            <button
              onClick={() => onCommissionPilot('simple_science')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl border border-slate-700 transition"
            >
              Originate Simple Science Series
            </button>
            <button
              onClick={() => onCommissionPilot('kindness_story')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl border border-slate-700 transition"
            >
              Originate Kindness Story Series
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {series.map((ser) => {
            let palette: string[] = [];
            try {
              palette = JSON.parse(ser.palette_hex || '[]');
            } catch (e) {
              palette = ['#2D68C4', '#F4A261'];
            }

            return (
              <div
                key={ser.id}
                className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-700 transition space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                        {ser.format.replace('_', ' ')} • Age {ser.age_band}
                      </span>
                      <h4 className="text-base font-bold text-white mt-0.5">{ser.title}</h4>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      {ser.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    {ser.description}
                  </p>

                  {/* Learning Goal */}
                  <div className="mt-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 text-xs text-slate-300">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Learning Goal</span>
                    {ser.learning_goal}
                  </div>

                  {/* Original Design Sheet & Palette */}
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Palette className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-[11px] text-slate-400">Design Palette:</span>
                      <div className="flex items-center gap-1.5">
                        {palette.map((color, cIdx) => (
                          <div
                            key={cIdx}
                            className="w-4 h-4 rounded-full border border-slate-700 shadow-sm"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-slate-400">
                      <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-[11px] text-slate-400 truncate">
                        Narrator: {ser.narrator_style}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Series Production Stats & Strategy Action */}
                <div className="pt-3 border-t border-slate-800/80">
                  <div className="grid grid-cols-2 gap-2 text-center text-xs mb-3">
                    <div className="bg-slate-950/60 p-2 rounded-lg">
                      <span className="text-[10px] text-slate-500 block uppercase">Episodes</span>
                      <span className="font-bold text-slate-200">{ser.total_published || 0} Live</span>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded-lg">
                      <span className="text-[10px] text-slate-500 block uppercase">Net Profit</span>
                      <span className="font-bold text-emerald-400">
                        ${(Number(ser.gross_earnings_usd || 0) - Number(ser.total_spend_usd || 0)).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => onEvaluateStrategy(ser.id)}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5 text-amber-400" />
                    <span>Evaluate Strategy with Jev</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Safety & Intellectual Property Assurance Footnote */}
      <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-2xl flex items-center justify-between text-xs text-slate-500">
        <span>Original IP preservation: Reusable design sheets, voice continuity & child safety rules stored locally.</span>
        <button
          onClick={onResetCatalog}
          className="text-xs text-rose-400 hover:text-rose-300 underline font-semibold transition"
        >
          Reset Content Catalog
        </button>
      </div>
    </div>
  );
};

export default SeriesCatalogTab;

