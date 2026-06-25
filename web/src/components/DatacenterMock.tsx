import type { ClusterMock, DatacenterMock } from '../types';
import { fmtInt } from '../format';

// Map a rack temperature to a cool->hot color. ~setpoint = green, T_MAX(32) = red.
function rackColor(tempC: number): string {
  const t = Math.max(0, Math.min(1, (tempC - 18) / (34 - 18)));
  const hue = 150 - t * 150; // 150 = emerald, 0 = red
  return `hsl(${hue}, 70%, ${42 + t * 6}%)`;
}

const STATE_RING: Record<ClusterMock['state'], string> = {
  idle: 'border-slate-600',
  active: 'border-emerald-500/60',
  hot: 'border-red-500/70',
};

const STATE_BADGE: Record<ClusterMock['state'], string> = {
  idle: 'bg-slate-600/30 text-slate-300',
  active: 'bg-emerald-500/20 text-emerald-300',
  hot: 'bg-red-500/20 text-red-300',
};

function ClusterTile({ c }: { c: ClusterMock }) {
  // Per-rack temps spread around the cluster average for a believable gradient.
  const racks = Array.from({ length: c.racks }, (_, i) => {
    const span = c.max_temp_c - c.avg_temp_c;
    const t = c.avg_temp_c + (i / Math.max(1, c.racks - 1) - 0.5) * 2 * span;
    return t;
  });
  return (
    <div className={`rounded-xl border ${STATE_RING[c.state]} bg-slate-900/50 p-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm text-slate-100">{c.name}</span>
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATE_BADGE[c.state]}`}>
          {c.state}
        </span>
      </div>
      <div className="grid grid-cols-6 gap-1">
        {racks.map((t, i) => (
          <div
            key={i}
            className="aspect-square rounded-[3px]"
            style={{ backgroundColor: rackColor(t) }}
            title={`Rack ${i + 1} · ${t.toFixed(1)} °C`}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1 text-center">
        <div>
          <div className="text-[10px] text-slate-500">Load</div>
          <div className="text-sm font-semibold text-slate-100">{Math.round(c.utilization_pct)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Temp</div>
          <div className="text-sm font-semibold text-slate-100">{c.avg_temp_c.toFixed(0)}°</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Power</div>
          <div className="text-sm font-semibold text-slate-100">{fmtInt(c.total_kw)}<span className="text-[10px] text-slate-500">kW</span></div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-900/40 border border-slate-700/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${accent || 'text-slate-100'}`}>
        {value}
        {unit && <span className="text-sm font-medium text-slate-400"> {unit}</span>}
      </div>
    </div>
  );
}

export function DatacenterMockView({ mock }: { mock: DatacenterMock }) {
  const f = mock.facility;
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Generated datacenter mock</h2>
        <p className="text-sm text-slate-400">
          {f.cooling_label} · {f.climate_label} climate · {fmtInt(f.total_racks)} racks across {f.num_clusters} clusters
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total draw" value={f.total_load_mw.toFixed(2)} unit="MW" accent="text-cyan-300" />
        <Stat label="PUE" value={f.pue.toFixed(2)} accent={f.pue <= 1.3 ? 'text-emerald-300' : f.pue <= 1.5 ? 'text-amber-300' : 'text-red-300'} />
        <Stat label="IT load" value={f.it_load_mw.toFixed(2)} unit="MW" />
        <Stat label="Density" value={f.power_density_w_per_sqft.toFixed(0)} unit="W/ft²" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {mock.clusters.map((c) => (
          <ClusterTile key={c.id} c={c} />
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: rackColor(20) }} /> cool
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: rackColor(27) }} /> warm
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: rackColor(33) }} /> hot
        </span>
        <span className="ml-auto">Cooling COP {f.cop.toFixed(1)} · free-cooling {Math.round(f.free_cooling_pct)}% of year · outside air {Math.round(f.outside_air_c)}°C</span>
      </div>
    </section>
  );
}
