// Shared types — mirror backend/schemas.py (snake_case kept verbatim).

export type CoolingType =
  | 'crac_air'
  | 'crah_chilled'
  | 'free_air'
  | 'rear_door'
  | 'direct_liquid'
  | 'immersion';

export type Climate = 'hot_arid' | 'hot_humid' | 'temperate' | 'cold' | 'continental';

export type PowerSource = 'grid' | 'mixed' | 'renewable';

export interface DatacenterSpec {
  name: string;
  num_clusters: number;
  racks_per_cluster: number;
  total_sqft: number;
  rack_density_kw: number;
  avg_utilization: number; // 0..1
  cooling_type: CoolingType;
  climate: Climate;
  power_source: PowerSource;
  renewable_pct: number; // 0..100
  setpoint_c: number;
  redundancy: 'N' | 'N+1' | '2N';
  grid_carbon_kg_per_kwh?: number | null;
  electricity_usd_per_kwh?: number | null;
}

export interface ClusterMock {
  id: number;
  name: string;
  utilization_pct: number;
  it_kw: number;
  cooling_kw: number;
  total_kw: number;
  avg_temp_c: number;
  max_temp_c: number;
  racks: number;
  hot_racks: number;
  state: 'idle' | 'active' | 'hot';
}

export interface MockFacility {
  name: string;
  num_clusters: number;
  racks_per_cluster: number;
  total_racks: number;
  total_sqft: number;
  it_load_kw: number;
  it_load_mw: number;
  cooling_load_kw: number;
  overhead_kw: number;
  total_load_kw: number;
  total_load_mw: number;
  pue: number;
  cop: number;
  power_density_w_per_sqft: number;
  cooling_label: string;
  climate_label: string;
  outside_air_c: number;
  free_cooling_pct: number;
}

export interface MockAnnual {
  energy_kwh: number;
  energy_mwh: number;
  cost_usd: number;
  co2_tonnes: number;
  water_liters: number;
  carbon_intensity_kg_per_kwh: number;
  price_usd_per_kwh: number;
  renewable_pct: number;
}

export interface DatacenterMock {
  facility: MockFacility;
  annual: MockAnnual;
  clusters: ClusterMock[];
}

export interface Recommendation {
  id: string;
  title: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  summary: string;
  detail: string;
  annual_kwh_saved: number;
  annual_co2_saved_tonnes: number;
  annual_cost_saved_usd: number;
  water_saved_liters: number;
  capex_estimate_usd: number;
  payback_years: number | null;
  effort: 'Low' | 'Medium' | 'High';
  ai_generated: boolean;
}

export interface CombinedSavings {
  annual_kwh_saved: number;
  annual_co2_saved_tonnes: number;
  annual_cost_saved_usd: number;
  water_saved_liters: number;
  pct_energy_reduction: number;
  pct_co2_reduction: number;
  projected_pue: number;
  trees_equivalent: number;
}

export interface OptimizationReport {
  ai_used: boolean;
  executive_summary: string;
  combined: CombinedSavings;
  recommendations: Recommendation[];
}

export interface GenerateResponse {
  spec: DatacenterSpec;
  mock: DatacenterMock;
  report: OptimizationReport;
}
