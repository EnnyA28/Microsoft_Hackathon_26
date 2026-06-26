import { useMemo } from 'react';

type StatsData = {
  energySavings: number;
  co2OffsetKg: number;
  powerDrawMW: number;
  coolingPUE: number;
};

type NodeData = {
  gpuLoad: number;
  temperature: string;
  cooling: number;
  status: string;
  clusterName: string;
};

type Recommendation = {
  id: string;
  rank: number;
  title: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  summary: string;
  detail: string;
  savings: string;
};

const CATEGORY_COLOR: Record<string, string> = {
  Cooling: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  Workload: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  Power: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  Controls: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
  Renewable: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
};

const PRIORITY_COLOR: Record<string, string> = {
  High: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  Medium: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  Low: 'bg-slate-600/30 tm-text-muted',
};

type Props = {
  stats: StatsData | null;
  nodes: NodeData[];
};

export function OptimizationPanel({ stats, nodes }: Props) {
  const recommendations = useMemo((): Recommendation[] => {
    if (!stats || nodes.length === 0) return [];

    const recs: Recommendation[] = [];
    const onlineNodes = nodes.filter(n => n.status !== 'offline');
    const avgGpu = onlineNodes.reduce((s, n) => s + n.gpuLoad, 0) / (onlineNodes.length || 1);
    const avgCooling = onlineNodes.reduce((s, n) => s + n.cooling, 0) / (onlineNodes.length || 1);
    const maxTemp = Math.max(...onlineNodes.map(n => parseFloat(String(n.temperature).replace('°C', '')) || 0));
    const pue = stats.coolingPUE;

    // Generate dynamic recommendations based on current telemetry
    if (avgCooling > avgGpu + 20) {
      recs.push({
        id: 'over-cooling',
        rank: 1,
        title: 'Reduce over-cooling in idle clusters',
        category: 'Cooling',
        priority: 'High',
        summary: `Cooling is running ${Math.round(avgCooling - avgGpu)}% above GPU load. AI setpoint optimization can close this gap.`,
        detail: 'Traditional fixed-setpoint cooling wastes energy by maintaining the same cold temperature regardless of load. Dynamic setpoint adjustment tracks actual thermal demand.',
        savings: `~${Math.round((avgCooling - avgGpu) * 0.3)}% energy reduction`,
      });
    }

    if (pue > 1.4) {
      recs.push({
        id: 'pue-improvement',
        rank: recs.length + 1,
        title: 'Improve PUE through cooling efficiency',
        category: 'Controls',
        priority: 'High',
        summary: `Current PUE of ${pue.toFixed(2)} indicates significant cooling overhead. Target: 1.2 or below.`,
        detail: 'Raising supply temperature by even 2°C improves COP by ~15%, directly reducing PUE. The AI controller manages this safely by monitoring all zone temperatures.',
        savings: `PUE ${pue.toFixed(2)} → ~1.20 (${Math.round(((pue - 1.2) / pue) * 100)}% cooling savings)`,
      });
    }

    if (avgGpu < 40) {
      recs.push({
        id: 'workload-consolidation',
        rank: recs.length + 1,
        title: 'Consolidate workloads to fewer active clusters',
        category: 'Workload',
        priority: 'Medium',
        summary: `Average GPU utilization is only ${Math.round(avgGpu)}%. Packing loads onto fewer nodes allows shutting down idle racks.`,
        detail: 'Idle servers still draw 35-40% of peak power. Consolidating to fewer active nodes and powering down the rest can save significant baseline energy.',
        savings: `~${Math.round((100 - avgGpu) * 0.15)}% power reduction from idle nodes`,
      });
    }

    if (maxTemp > 28) {
      recs.push({
        id: 'hotspot-mitigation',
        rank: recs.length + 1,
        title: 'Address thermal hotspots',
        category: 'Cooling',
        priority: maxTemp > 30 ? 'High' : 'Medium',
        summary: `Peak temperature of ${maxTemp.toFixed(1)}°C detected. Pre-emptive cooling can prevent thermal throttling.`,
        detail: 'Hotspots reduce GPU performance and reliability. The AI controller pre-cools affected zones before temperature reaches critical thresholds.',
        savings: 'Prevents thermal throttling (up to 30% GPU perf loss)',
      });
    }

    // Always-applicable recommendations
    recs.push({
      id: 'renewable-shift',
      rank: recs.length + 1,
      title: 'Shift batch workloads to renewable energy windows',
      category: 'Renewable',
      priority: 'Medium',
      summary: 'Schedule non-urgent training jobs during peak solar/wind hours to reduce carbon intensity.',
      detail: 'Azure regions provide carbon-intensity signals. Shifting 40% of batch GPU workloads to low-carbon windows can reduce emissions by 20-30% without impacting latency-sensitive workloads.',
      savings: '~25% CO₂ reduction on batch workloads',
    });

    recs.push({
      id: 'free-cooling',
      rank: recs.length + 1,
      title: 'Maximize free-cooling hours with outside air',
      category: 'Cooling',
      priority: 'Low',
      summary: 'Use economizer mode when ambient temperature is below setpoint to reduce compressor runtime.',
      detail: 'In temperate climates, free-cooling can provide 40-60% of annual cooling hours. The AI controller can dynamically switch between mechanical and free-cooling based on outdoor conditions.',
      savings: '~15% annual cooling energy in temperate climates',
    });

    return recs;
  }, [stats, nodes]);

  if (!stats) return null;

  return (
    <section className="tm-panel p-5 space-y-4">
      {/* Headline */}
      <div className="rounded-xl border border-[#0078D4]/30 bg-gradient-to-br from-[#0078D4]/10 to-[#50E6FF]/5 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold tm-text-primary">⚡ AI Optimization Insights</h2>
          <span className="text-[10px] px-2 py-1 rounded-full bg-[#0078D4]/20 text-[#0078D4]">
            Live · {recommendations.length} recommendations
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.energySavings.toFixed(1)}%</div>
            <div className="text-[10px] tm-text-muted">Energy saved vs baseline</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{stats.coolingPUE.toFixed(2)}</div>
            <div className="text-[10px] tm-text-muted">Current PUE</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">${Math.round(stats.co2OffsetKg * 365 * 0.1)}</div>
            <div className="text-[10px] tm-text-muted">Projected annual savings</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">{stats.co2OffsetKg}</div>
            <div className="text-[10px] tm-text-muted">kg CO₂ saved/day</div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold tm-text-muted uppercase tracking-wider">
          Ranked recommendations · environment-first
        </h3>
        {recommendations.map((r) => (
          <details key={r.id} className="group rounded-xl border border-[var(--tm-border)] tm-card transition">
            <summary className="cursor-pointer list-none p-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0078D4]/20 text-[10px] font-bold text-[#0078D4]">
                  {r.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm tm-text-primary">{r.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[r.category] || 'bg-slate-700/30 tm-text-muted border-slate-600'}`}>{r.category}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_COLOR[r.priority]}`}>{r.priority}</span>
                  </div>
                  <p className="mt-1 text-xs tm-text-muted">{r.summary}</p>
                  <div className="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{r.savings}</div>
                </div>
                <span className="tm-text-muted text-xs group-open:rotate-180 transition mt-1">▾</span>
              </div>
            </summary>
            <div className="px-3 pb-3 pl-11">
              <p className="text-xs leading-relaxed tm-text-muted border-l-2 border-[#0078D4]/40 pl-3">{r.detail}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
