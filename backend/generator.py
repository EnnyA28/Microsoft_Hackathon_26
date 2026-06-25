"""backend/generator.py --- turn a DatacenterSpec into a generated mock (phase 1).

This is the "digital twin" half: given what the user typed, estimate the real
power, cooling, efficiency (PUE), temperatures and annual footprint of the
facility *as it stands today*. Those numbers become both the picture the UI draws
and the baseline the advisor improves on.

Physics constants are reused from the repo-root ``model.py`` (Contract D) so the
mock stays grounded in the same numbers the rest of the project trusts.
"""

from __future__ import annotations

import math

import model  # repo-root physics module (kept on import path by backend/__init__.py)

from backend.schemas import (
    ClusterMock,
    DatacenterMock,
    DatacenterSpec,
    MockAnnual,
    MockFacility,
)

HOURS_PER_YEAR = 8760.0

# Servers idle at a fraction of nameplate (mirrors model.P_IDLE_W / model.P_MAX_W).
IDLE_FRACTION = model.P_IDLE_W / model.P_MAX_W  # ~0.375

# Carbon/cost defaults used when the spec leaves the overrides blank.
BASE_GRID_CARBON_KG_PER_KWH = 0.40  # global-ish blended grid average
DEFAULT_PRICE_USD_PER_KWH = 0.10  # industrial electricity tariff

# Power-chain (UPS/PDU/transformer) loss as a fraction of IT load, by redundancy.
REDUNDANCY_LOSS = {"N": 0.06, "N+1": 0.08, "2N": 0.12}

# Extra COP a free-cooling-capable plant gains from a fully economizer-friendly
# climate (scaled by the climate's free-cooling fraction).
FREE_COOLING_COP_GAIN = 4.0


# Per-cooling-technology characteristics. ``base_cop`` is the effective plant COP
# (IT heat removed per unit of cooling electricity) before any free-cooling bonus.
COOLING_PROFILES: dict[str, dict] = {
    "crac_air": dict(
        label="Legacy CRAC (room DX air)",
        base_cop=2.8, free_cooling=False, water_wue=0.0,
        max_density_kw=6.0, temp_gain_c=12.0,
    ),
    "crah_chilled": dict(
        label="Chilled-water CRAH",
        base_cop=4.0, free_cooling=True, water_wue=1.8,
        max_density_kw=15.0, temp_gain_c=10.0,
    ),
    "free_air": dict(
        label="Air-side economizer (free cooling)",
        base_cop=7.0, free_cooling=True, water_wue=0.4,
        max_density_kw=12.0, temp_gain_c=10.0,
    ),
    "rear_door": dict(
        label="Rear-door heat exchanger",
        base_cop=5.5, free_cooling=True, water_wue=0.6,
        max_density_kw=35.0, temp_gain_c=6.0,
    ),
    "direct_liquid": dict(
        label="Direct-to-chip liquid",
        base_cop=7.5, free_cooling=True, water_wue=0.3,
        max_density_kw=80.0, temp_gain_c=4.0,
    ),
    "immersion": dict(
        label="Immersion cooling",
        base_cop=10.0, free_cooling=True, water_wue=0.1,
        max_density_kw=150.0, temp_gain_c=3.0,
    ),
}

CLIMATE_PROFILES: dict[str, dict] = {
    "hot_arid": dict(label="Hot / arid", outside_air_c=28.0, free_cooling_pct=0.20, water_stress=True),
    "hot_humid": dict(label="Hot / humid", outside_air_c=30.0, free_cooling_pct=0.05, water_stress=False),
    "temperate": dict(label="Temperate", outside_air_c=14.0, free_cooling_pct=0.65, water_stress=False),
    "cold": dict(label="Cold", outside_air_c=5.0, free_cooling_pct=0.90, water_stress=False),
    "continental": dict(label="Continental (seasonal)", outside_air_c=12.0, free_cooling_pct=0.70, water_stress=False),
}


def cooling_profile(spec: DatacenterSpec) -> dict:
    return COOLING_PROFILES[spec.cooling_type.value]


def climate_profile(spec: DatacenterSpec) -> dict:
    return CLIMATE_PROFILES[spec.climate.value]


def effective_cop(spec: DatacenterSpec) -> float:
    """Plant COP including the climate-driven free-cooling bonus."""
    cool = cooling_profile(spec)
    clim = climate_profile(spec)
    cop = cool["base_cop"]
    if cool["free_cooling"]:
        cop += FREE_COOLING_COP_GAIN * clim["free_cooling_pct"]
    return round(cop, 2)


def loss_fraction(spec: DatacenterSpec) -> float:
    return REDUNDANCY_LOSS.get(spec.redundancy, 0.08)


def carbon_intensity(spec: DatacenterSpec) -> float:
    """kg CO2 per kWh after accounting for the renewable share."""
    if spec.grid_carbon_kg_per_kwh is not None:
        return spec.grid_carbon_kg_per_kwh
    return BASE_GRID_CARBON_KG_PER_KWH * (1.0 - spec.renewable_pct / 100.0)


def price_per_kwh(spec: DatacenterSpec) -> float:
    return spec.electricity_usd_per_kwh if spec.electricity_usd_per_kwh is not None else DEFAULT_PRICE_USD_PER_KWH


def _per_rack_kw(rack_density_kw: float, utilization: float) -> float:
    """Actual draw of a rack = idle floor + load-scaled remainder of nameplate."""
    return rack_density_kw * (IDLE_FRACTION + (1.0 - IDLE_FRACTION) * utilization)


def _cluster_utilizations(spec: DatacenterSpec) -> list[float]:
    """Deterministic per-cluster utilization spread around the fleet average.

    A sinusoid gives some clusters a hotspot and others slack so the generated
    floor map shows variety, while staying perfectly reproducible (no RNG).
    """
    n = spec.num_clusters
    amp = 0.18
    out: list[float] = []
    for i in range(n):
        phase = 2.0 * math.pi * i / max(1, n)
        u = spec.avg_utilization + amp * math.sin(phase)
        out.append(min(1.0, max(0.04, u)))
    return out


def generate_mock(spec: DatacenterSpec) -> DatacenterMock:
    """Build the full DatacenterMock (facility totals + per-cluster breakdown)."""
    cool = cooling_profile(spec)
    clim = climate_profile(spec)
    cop = effective_cop(spec)
    loss = loss_fraction(spec)
    ci = carbon_intensity(spec)
    price = price_per_kwh(spec)
    temp_gain = cool["temp_gain_c"]

    utils = _cluster_utilizations(spec)
    clusters: list[ClusterMock] = []

    it_kw_total = 0.0
    cooling_kw_total = 0.0
    overhead_kw_total = 0.0

    for i, u in enumerate(utils):
        per_rack = _per_rack_kw(spec.rack_density_kw, u)
        it_kw = per_rack * spec.racks_per_cluster
        cooling_kw = it_kw / cop
        overhead_kw = it_kw * loss
        total_kw = it_kw + cooling_kw + overhead_kw

        avg_temp = spec.setpoint_c + temp_gain * u
        max_temp = avg_temp + temp_gain * 0.18

        hot_frac = min(1.0, max(0.0, (u - 0.7) / 0.3))
        hot_racks = int(round(spec.racks_per_cluster * hot_frac))
        if u < 0.30:
            state = "idle"
        elif u > 0.78 or max_temp > model.T_MAX - 2.0:
            state = "hot"
        else:
            state = "active"

        clusters.append(
            ClusterMock(
                id=i,
                name=f"Cluster {chr(ord('A') + i) if i < 26 else i + 1}",
                utilization_pct=round(u * 100.0, 1),
                it_kw=round(it_kw, 1),
                cooling_kw=round(cooling_kw, 1),
                total_kw=round(total_kw, 1),
                avg_temp_c=round(avg_temp, 1),
                max_temp_c=round(max_temp, 1),
                racks=spec.racks_per_cluster,
                hot_racks=hot_racks,
                state=state,
            )
        )
        it_kw_total += it_kw
        cooling_kw_total += cooling_kw
        overhead_kw_total += overhead_kw

    total_kw = it_kw_total + cooling_kw_total + overhead_kw_total
    pue = total_kw / it_kw_total if it_kw_total > 0 else float("nan")

    energy_kwh = total_kw * HOURS_PER_YEAR
    cost_usd = energy_kwh * price
    co2_tonnes = energy_kwh * ci / 1000.0
    water_liters = energy_kwh * cool["water_wue"]

    facility = MockFacility(
        name=spec.name,
        num_clusters=spec.num_clusters,
        racks_per_cluster=spec.racks_per_cluster,
        total_racks=spec.num_clusters * spec.racks_per_cluster,
        total_sqft=spec.total_sqft,
        it_load_kw=round(it_kw_total, 1),
        it_load_mw=round(it_kw_total / 1000.0, 3),
        cooling_load_kw=round(cooling_kw_total, 1),
        overhead_kw=round(overhead_kw_total, 1),
        total_load_kw=round(total_kw, 1),
        total_load_mw=round(total_kw / 1000.0, 3),
        pue=round(pue, 3),
        cop=cop,
        power_density_w_per_sqft=round(it_kw_total * 1000.0 / spec.total_sqft, 1),
        cooling_label=cool["label"],
        climate_label=clim["label"],
        outside_air_c=clim["outside_air_c"],
        free_cooling_pct=round(clim["free_cooling_pct"] * 100.0, 0),
    )
    annual = MockAnnual(
        energy_kwh=round(energy_kwh, 0),
        energy_mwh=round(energy_kwh / 1000.0, 0),
        cost_usd=round(cost_usd, 0),
        co2_tonnes=round(co2_tonnes, 1),
        water_liters=round(water_liters, 0),
        carbon_intensity_kg_per_kwh=round(ci, 3),
        price_usd_per_kwh=round(price, 3),
        renewable_pct=spec.renewable_pct,
    )
    return DatacenterMock(facility=facility, annual=annual, clusters=clusters)
