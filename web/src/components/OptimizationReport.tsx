import type { OptimizationReport, Recommendation } from '../types';
import { fmtEnergy, fmtInt, fmtMoney, fmtTonnes, fmtWater } from '../format';

const CATEGORY_COLOR: Record<string, string> = {
  Cooling: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  Renewable: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Workload: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  HeatReuse: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  Water: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Power: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Controls: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
};

const PRIORITY_COLOR: Record<string, string> = {
  High: 'bg-emerald-500/20 text-emerald-300',
  Medium: 'bg-amber-500/20 text-amber-300',
  Low: 'bg-slate-600/30 text-slate-300',
};

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-semibold ${accent || 'text-slate-200'}`}>{value}</div>
    </div>
  );
}

function RecCard({ r, rank }: { r: Recommendation; rank: number }) {
  return (
    <details className="group rounded-xl border border-slate-700/60 bg-slate-900/40 open:bg-slate-900/60 transition">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-emerald-300">
            {rank}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-100">{r.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[r.category] || 'bg-slate-700/30 text-slate-300 border-slate-600'}`}>{r.category}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_COLOR[r.priority]}`}>{r.priority}</span>
              {r.ai_generated && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-400/40 bg-emerald-400/10 text-emerald-200">✦ AI-suggested</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-400">{r.summary}</p>
          </div>
          <span className="text-slate-500 text-xs group-open:rotate-180 transition mt-1">▾</span>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 pl-9">
          <Metric label="CO₂ avoided" value={r.annual_co2_saved_tonnes > 0 ? `${fmtTonnes(r.annual_co2_saved_tonnes)}/yr` : '—'} accent="text-emerald-300" />
          <Metric label="Energy" value={r.annual_kwh_saved > 0 ? `${fmtEnergy(r.annual_kwh_saved)}/yr` : '—'} />
          <Metric label="Cost" value={r.annual_cost_saved_usd > 0 ? `${fmtMoney(r.annual_cost_saved_usd)}/yr` : '—'} />
          <Metric label="Effort" value={r.effort} />
        </div>
      </summary>
      <div className="px-4 pb-4 pl-13">
        <p className="text-sm leading-relaxed text-slate-300 border-l-2 border-emerald-500/40 pl-3 ml-9">{r.detail}</p>
        <div className="mt-3 ml-9 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          {r.water_saved_liters > 0 && <span>Water saved: <b className="text-sky-300">{fmtWater(r.water_saved_liters)}/yr</b></span>}
          {r.capex_estimate_usd > 0 && <span>Est. capex: <b className="text-slate-200">{fmtMoney(r.capex_estimate_usd)}</b></span>}
          {r.payback_years != null && <span>Payback: <b className="text-slate-200">{r.payback_years} yr</b></span>}
        </div>
      </div>
    </details>
  );
}

function Headline({ report }: { report: OptimizationReport }) {
  const c = report.combined;
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Environment-first optimization report</h2>
        <span className={`text-xs px-2 py-1 rounded-full ${report.ai_used ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/40 text-slate-300'}`}>
          {report.ai_used ? '✦ AI-enhanced' : 'Rule-based'}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <div className="text-3xl font-bold text-emerald-300">−{c.pct_co2_reduction.toFixed(0)}%</div>
          <div className="text-xs text-slate-400 mt-1">CO₂ · {fmtTonnes(c.annual_co2_saved_tonnes)}/yr avoided</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-cyan-300">−{c.pct_energy_reduction.toFixed(0)}%</div>
          <div className="text-xs text-slate-400 mt-1">Energy · {fmtEnergy(c.annual_kwh_saved)}/yr</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-amber-300">{fmtMoney(c.annual_cost_saved_usd)}</div>
          <div className="text-xs text-slate-400 mt-1">Cost saved / yr</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-teal-300">{c.projected_pue.toFixed(2)}</div>
          <div className="text-xs text-slate-400 mt-1">Projected PUE · 🌳 ≈ {fmtInt(c.trees_equivalent)} trees</div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-300">{report.executive_summary}</p>
    </div>
  );
}

export function OptimizationReportView({ report }: { report: OptimizationReport }) {
  return (
    <section className="space-y-4">
      <Headline report={report} />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {report.recommendations.length} recommendations · environment-first
        </h3>
        {report.recommendations.map((r, i) => (
          <RecCard key={r.id} r={r} rank={i + 1} />
        ))}
      </div>
    </section>
  );
}
