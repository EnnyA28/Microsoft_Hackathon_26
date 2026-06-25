import { useEffect, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import type { Climate, CoolingType, DatacenterSpec, PowerSource } from '../types';

const COOLING_OPTIONS: { value: CoolingType; label: string }[] = [
  { value: 'crac_air', label: 'Legacy CRAC (room air)' },
  { value: 'crah_chilled', label: 'Chilled-water CRAH' },
  { value: 'free_air', label: 'Air-side economizer' },
  { value: 'rear_door', label: 'Rear-door heat exchanger' },
  { value: 'direct_liquid', label: 'Direct-to-chip liquid' },
  { value: 'immersion', label: 'Immersion cooling' },
];

const CLIMATE_OPTIONS: { value: Climate; label: string }[] = [
  { value: 'hot_arid', label: 'Hot / arid' },
  { value: 'hot_humid', label: 'Hot / humid' },
  { value: 'temperate', label: 'Temperate' },
  { value: 'cold', label: 'Cold' },
  { value: 'continental', label: 'Continental (seasonal)' },
];

const POWER_OPTIONS: { value: PowerSource; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'renewable', label: 'Mostly renewable' },
];

export const DEFAULT_SPEC: DatacenterSpec = {
  name: 'Riverside DC-1',
  num_clusters: 8,
  racks_per_cluster: 12,
  total_sqft: 12000,
  rack_density_kw: 10,
  avg_utilization: 0.55,
  cooling_type: 'crah_chilled',
  climate: 'temperate',
  power_source: 'grid',
  renewable_pct: 15,
  setpoint_c: 22,
  redundancy: 'N+1',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-200">{label}</span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// Number inputs are managed as text so the user can edit freely — this strips
// sticky leading zeros (e.g. "08000"), allows a momentarily empty field, and
// clamps to min/max on blur.
function NumInput({
  value,
  onValue,
  ...rest
}: { value: number; onValue: (n: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    // Re-sync if the value is changed elsewhere, without fighting active typing.
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        let raw = e.target.value.replace(/[^\d.]/g, '');
        raw = raw.replace(/^0+(?=\d)/, ''); // drop leading zeros but keep "0" and "0.x"
        setText(raw);
        if (raw !== '' && raw !== '.') {
          const n = Number(raw);
          if (Number.isFinite(n)) onValue(n);
        }
      }}
      onBlur={() => {
        let n = Number(text);
        if (text === '' || !Number.isFinite(n)) n = value;
        const min = rest.min !== undefined ? Number(rest.min) : undefined;
        const max = rest.max !== undefined ? Number(rest.max) : undefined;
        if (min !== undefined && n < min) n = min;
        if (max !== undefined && n > max) n = max;
        setText(String(n));
        if (n !== value) onValue(n);
      }}
    />
  );
}

const inputClass =
  'w-full rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-slate-100 ' +
  'focus:outline-none focus:border-emerald-400/70 focus:ring-1 focus:ring-emerald-400/40 transition';

export function SpecForm({
  onGenerate,
  loading,
}: {
  onGenerate: (spec: DatacenterSpec) => void;
  loading: boolean;
}) {
  const [spec, setSpec] = useState<DatacenterSpec>(DEFAULT_SPEC);

  const set = <K extends keyof DatacenterSpec>(key: K, value: DatacenterSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate(spec);
      }}
    >
      <Field label="Facility name">
        <input className={inputClass} value={spec.name} onChange={(e) => set('name', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Clusters">
          <NumInput min={1} max={64} className={inputClass} value={spec.num_clusters} onValue={(n) => set('num_clusters', n)} />
        </Field>
        <Field label="Racks / cluster">
          <NumInput min={1} max={400} className={inputClass} value={spec.racks_per_cluster} onValue={(n) => set('racks_per_cluster', n)} />
        </Field>
        <Field label="Floor area" hint="sq ft">
          <NumInput min={100} className={inputClass} value={spec.total_sqft} onValue={(n) => set('total_sqft', n)} />
        </Field>
        <Field label="Rack density" hint="kW / rack">
          <NumInput min={1} max={200} step={0.5} className={inputClass} value={spec.rack_density_kw} onValue={(n) => set('rack_density_kw', n)} />
        </Field>
      </div>

      <Field label="Average utilization" hint={`${Math.round(spec.avg_utilization * 100)}%`}>
        <input type="range" min={0} max={100} value={Math.round(spec.avg_utilization * 100)} onChange={(e) => set('avg_utilization', Number(e.target.value) / 100)} className="w-full accent-emerald-400" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Cooling system">
          <select className={inputClass} value={spec.cooling_type} onChange={(e) => set('cooling_type', e.target.value as CoolingType)}>
            {COOLING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Climate">
          <select className={inputClass} value={spec.climate} onChange={(e) => set('climate', e.target.value as Climate)}>
            {CLIMATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Supply setpoint" hint={`${spec.setpoint_c} °C`}>
        <input type="range" min={16} max={30} step={0.5} value={spec.setpoint_c} onChange={(e) => set('setpoint_c', Number(e.target.value))} className="w-full accent-emerald-400" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Power source">
          <select className={inputClass} value={spec.power_source} onChange={(e) => set('power_source', e.target.value as PowerSource)}>
            {POWER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Redundancy">
          <select className={inputClass} value={spec.redundancy} onChange={(e) => set('redundancy', e.target.value as DatacenterSpec['redundancy'])}>
            <option value="N">N</option>
            <option value="N+1">N+1</option>
            <option value="2N">2N</option>
          </select>
        </Field>
      </div>

      <Field label="Renewable share" hint={`${spec.renewable_pct}%`}>
        <input type="range" min={0} max={100} value={spec.renewable_pct} onChange={(e) => set('renewable_pct', Number(e.target.value))} className="w-full accent-emerald-400" />
      </Field>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-semibold text-slate-950 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-60 disabled:cursor-not-allowed transition shadow-lg shadow-emerald-500/20"
      >
        {loading ? 'Generating…' : 'Generate digital twin'}
      </button>
    </form>
  );
}
