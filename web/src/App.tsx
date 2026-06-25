import { useEffect, useState } from 'react';
import { generateTwin, checkHealth } from './api';
import type { DatacenterSpec, GenerateResponse } from './types';
import { SpecForm } from './components/SpecForm';
import { DatacenterMockView } from './components/DatacenterMock';
import { OptimizationReportView } from './components/OptimizationReport';

function Header({ aiConfigured }: { aiConfigured: boolean | null }) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🌿</span>
          <div>
            <div className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              EcoTwin
            </div>
            <div className="text-xs text-slate-500 -mt-0.5">Environment-first datacenter advisor</div>
          </div>
        </div>
        {aiConfigured !== null && (
          <span className={`text-xs px-2.5 py-1 rounded-full border ${aiConfigured ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/50 text-slate-400'}`}>
            {aiConfigured ? '✦ AI model connected' : 'Offline rule engine'}
          </span>
        )}
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-10 text-center">
      <div className="text-4xl mb-3">🏭</div>
      <h2 className="text-lg font-semibold text-slate-200">Describe your datacenter to begin</h2>
      <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
        Enter the cluster count, footprint, cooling system and power profile. EcoTwin generates a
        physics-grounded mock of the facility, then ranks upgrades by the carbon they cut.
      </p>
    </div>
  );
}

export default function App() {
  const [response, setResponse] = useState<GenerateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    checkHealth()
      .then((h) => setAiConfigured(h.ai_configured))
      .catch(() => setAiConfigured(null));
  }, []);

  const handleGenerate = async (spec: DatacenterSpec) => {
    setLoading(true);
    setError(null);
    try {
      const data = await generateTwin(spec);
      setResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate. Is the backend running on :8000?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full">
      <Header aiConfigured={aiConfigured} />
      <main className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 lg:sticky lg:top-24">
          <h1 className="text-base font-semibold text-slate-100 mb-4">Facility specification</h1>
          <SpecForm onGenerate={handleGenerate} loading={loading} />
        </div>

        <div className="space-y-6 min-w-0">
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {!response && !error && <EmptyState />}
          {response && (
            <>
              <DatacenterMockView mock={response.mock} />
              <OptimizationReportView report={response.report} />
            </>
          )}
        </div>
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-center text-xs text-slate-600">
        EcoTwin · generated mocks are physics-grounded estimates for planning, not measured data
      </footer>
    </div>
  );
}
