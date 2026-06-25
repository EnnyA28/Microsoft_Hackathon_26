"""backend/schemas.py --- the data contracts for EcoTwin.

The flow is one request/response:

    DatacenterSpec  --(generator)-->  DatacenterMock          # phase 1: the "as-built" twin
    DatacenterMock  --(advisor)---->  OptimizationReport      # environment-first upgrades

All JSON keys are snake_case so the same names are used verbatim by the React UI.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Input                                                                        #
# --------------------------------------------------------------------------- #
class CoolingType(str, Enum):
    crac_air = "crac_air"  # legacy room-level DX air conditioning
    crah_chilled = "crah_chilled"  # chilled-water CRAH
    free_air = "free_air"  # air-side economizer / free cooling
    rear_door = "rear_door"  # rear-door heat exchanger
    direct_liquid = "direct_liquid"  # direct-to-chip liquid cooling
    immersion = "immersion"  # single/two-phase immersion


class Climate(str, Enum):
    hot_arid = "hot_arid"
    hot_humid = "hot_humid"
    temperate = "temperate"
    cold = "cold"
    continental = "continental"


class PowerSource(str, Enum):
    grid = "grid"
    mixed = "mixed"
    renewable = "renewable"


class DatacenterSpec(BaseModel):
    """Everything the user types in. This is the context handed to the model."""

    name: str = Field("Untitled Facility", max_length=80)
    num_clusters: int = Field(8, ge=1, le=64, description="compute clusters / pods")
    racks_per_cluster: int = Field(12, ge=1, le=400)
    total_sqft: float = Field(12000.0, gt=0, le=5_000_000)
    rack_density_kw: float = Field(10.0, gt=0, le=200, description="avg kW per rack (nameplate)")
    avg_utilization: float = Field(0.55, ge=0.0, le=1.0, description="fleet-wide average load")
    cooling_type: CoolingType = CoolingType.crah_chilled
    climate: Climate = Climate.temperate
    power_source: PowerSource = PowerSource.grid
    renewable_pct: float = Field(15.0, ge=0.0, le=100.0)
    setpoint_c: float = Field(22.0, ge=16.0, le=30.0, description="cold-supply / coolant setpoint")
    redundancy: str = Field("N+1", pattern="^(N|N\\+1|2N)$")

    # Optional overrides (left blank -> sensible regional defaults are derived).
    grid_carbon_kg_per_kwh: float | None = Field(None, ge=0.0, le=1.5)
    electricity_usd_per_kwh: float | None = Field(None, ge=0.0, le=2.0)


# --------------------------------------------------------------------------- #
# Generated mock (phase 1)                                                     #
# --------------------------------------------------------------------------- #
class ClusterMock(BaseModel):
    id: int
    name: str
    utilization_pct: float
    it_kw: float
    cooling_kw: float
    total_kw: float
    avg_temp_c: float
    max_temp_c: float
    racks: int
    hot_racks: int
    state: str  # "idle" | "active" | "hot"


class MockFacility(BaseModel):
    name: str
    num_clusters: int
    racks_per_cluster: int
    total_racks: int
    total_sqft: float
    it_load_kw: float
    it_load_mw: float
    cooling_load_kw: float
    overhead_kw: float
    total_load_kw: float
    total_load_mw: float
    pue: float
    cop: float
    power_density_w_per_sqft: float
    cooling_label: str
    climate_label: str
    outside_air_c: float
    free_cooling_pct: float


class MockAnnual(BaseModel):
    energy_kwh: float
    energy_mwh: float
    cost_usd: float
    co2_tonnes: float
    water_liters: float
    carbon_intensity_kg_per_kwh: float
    price_usd_per_kwh: float
    renewable_pct: float


class DatacenterMock(BaseModel):
    facility: MockFacility
    annual: MockAnnual
    clusters: list[ClusterMock]


# --------------------------------------------------------------------------- #
# Optimization report                                                          #
# --------------------------------------------------------------------------- #
class Recommendation(BaseModel):
    id: str
    title: str
    category: str  # Cooling | Power | Renewable | Workload | Water | HeatReuse | Controls
    priority: str  # High | Medium | Low (environment-first ranking)
    summary: str
    detail: str
    annual_kwh_saved: float
    annual_co2_saved_tonnes: float
    annual_cost_saved_usd: float
    water_saved_liters: float
    capex_estimate_usd: float
    payback_years: float | None
    effort: str  # Low | Medium | High
    ai_generated: bool = False  # True for AI-proposed qualitative measures (no quantified savings)


class CombinedSavings(BaseModel):
    annual_kwh_saved: float
    annual_co2_saved_tonnes: float
    annual_cost_saved_usd: float
    water_saved_liters: float
    pct_energy_reduction: float
    pct_co2_reduction: float
    projected_pue: float
    trees_equivalent: int


class OptimizationReport(BaseModel):
    ai_used: bool
    executive_summary: str
    combined: CombinedSavings
    recommendations: list[Recommendation]


class GenerateResponse(BaseModel):
    spec: DatacenterSpec
    mock: DatacenterMock
    report: OptimizationReport
