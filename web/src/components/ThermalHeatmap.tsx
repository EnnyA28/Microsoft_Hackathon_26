import { useMemo } from 'react';

// Map a rack temperature to a cool→hot color (18°C = green, 34°C = red)
function rackColor(tempC: number): string {
  const t = Math.max(0, Math.min(1, (tempC - 18) / (34 - 18)));
  const hue = 150 - t * 150; // 150 = emerald, 0 = red
  return `hsl(${hue}, 70%, ${42 + t * 6}%)`;
}

type NodeData = {
  id: number;
  label: string;
  clusterName: string;
  state: 'active' | 'hot' | 'idle';
  gpuLoad: number;
  temperature: string;
  cooling: number;
  powerUsage: number;
  status: string;
};

type ClusterInfo = {
  name: string;
  status: 'active' | 'idle' | 'optimizing';
  gpu: number;
  cooling: number;
  power: number;
};

type Props = {
  nodes: NodeData[];
  clusters: ClusterInfo[];
};

type ClusterSummary = {
  name: string;
  state: 'idle' | 'active' | 'hot';
  utilization: number;
  avgTemp: number;
  maxTemp: number;
  totalPower: number;
  rackTemps: number[];
};

export function ThermalHeatmap({ nodes, clusters }: Props) {
  const clusterSummaries = useMemo(() => {
    const grouped: Record<string, NodeData[]> = {};
    nodes.forEach(node => {
      const cluster = node.clusterName;
      if (!grouped[cluster]) grouped[cluster] = [];
      grouped[cluster].push(node);
    });

    return Object.entries(grouped).map(([name, clusterNodes]): ClusterSummary => {
      const onlineNodes = clusterNodes.filter(n => n.status !== 'offline');
      const avgGpu = onlineNodes.length > 0
        ? onlineNodes.reduce((s, n) => s + n.gpuLoad, 0) / onlineNodes.length
        : 0;
      const temps = onlineNodes.map(n => parseFloat(String(n.temperature).replace('°C', '')) || 0);
      const avgTemp = temps.length > 0 ? temps.reduce((s, t) => s + t, 0) / temps.length : 0;
      const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
      const totalPower = onlineNodes.reduce((s, n) => s + n.powerUsage, 0);

      // Group into 6 racks (8 nodes each), average temp per rack
      const rackTemps: number[] = [];
      for (let r = 0; r < 6; r++) {
        const rackNodes = onlineNodes.slice(r * 8, (r + 1) * 8);
        if (rackNodes.length > 0) {
          const rackAvgTemp = rackNodes.reduce((s, n) => s + (parseFloat(String(n.temperature).replace('°C', '')) || 0), 0) / rackNodes.length;
          rackTemps.push(rackAvgTemp);
        } else {
          rackTemps.push(20);
        }
      }

      let state: 'idle' | 'active' | 'hot' = 'idle';
      if (avgGpu > 70) state = 'hot';
      else if (avgGpu > 30) state = 'active';

      return { name, state, utilization: avgGpu, avgTemp, maxTemp, totalPower, rackTemps };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes]);

  const STATE_RING: Record<string, string> = {
    idle: 'border-[var(--tm-border)]',
    active: 'border-emerald-500/60',
    hot: 'border-red-500/70',
  };

  const STATE_BADGE: Record<string, string> = {
    idle: 'bg-slate-600/30 tm-text-muted',
    active: 'bg-emerald-500/20 text-emerald-400',
    hot: 'bg-red-500/20 text-red-400',
  };

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {clusterSummaries.map((c) => (
          <div key={c.name} className={`rounded-xl border ${STATE_RING[c.state]} tm-card p-3`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm tm-text-primary">Cluster {c.name}</span>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATE_BADGE[c.state]}`}>
                {c.state}
              </span>
            </div>
            {/* Rack thermal grid */}
            <div className="grid grid-cols-6 gap-1">
              {c.rackTemps.map((t, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-[3px]"
                  style={{ backgroundColor: rackColor(t) }}
                  title={`Rack ${i + 1} · ${t.toFixed(1)}°C`}
                />
              ))}
            </div>
            {/* Stats */}
            <div className="mt-2.5 grid grid-cols-3 gap-1 text-center">
              <div>
                <div className="text-[10px] tm-text-muted">Load</div>
                <div className="text-sm font-semibold tm-text-primary">{Math.round(c.utilization)}%</div>
              </div>
              <div>
                <div className="text-[10px] tm-text-muted">Temp</div>
                <div className="text-sm font-semibold tm-text-primary">{c.avgTemp.toFixed(0)}°C</div>
              </div>
              <div>
                <div className="text-[10px] tm-text-muted">Power</div>
                <div className="text-sm font-semibold tm-text-primary">{c.totalPower.toFixed(0)}<span className="text-[10px] tm-text-muted">kW</span></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs tm-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: rackColor(20) }} /> Cool
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: rackColor(27) }} /> Warm
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: rackColor(33) }} /> Hot
        </span>
        <span className="ml-auto">6 clusters · 36 racks · {nodes.length} nodes</span>
      </div>
    </section>
  );
}
