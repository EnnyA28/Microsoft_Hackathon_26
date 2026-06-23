"""bridge/adapter.py --- map DC-Twin physics into ThermaMind's telemetry shape.

The ThermaMind React frontend (web/) consumes a fixed ``TelemetrySnapshot`` JSON
(see web/src/hooks/useTelemetry.ts). This module converts the *real* per-zone
state coming out of :class:`env.DCTwinEnv` into that exact shape, so the gorgeous
dashboard renders genuine, physics-grounded numbers instead of mock data.

Key mapping decisions
---------------------
* DC-Twin has ``N_ZONES`` (8) thermal zones -> we present 8 clusters A..H, each
  with ``NODES_PER_ZONE`` (8) GPU nodes derived from the zone's real util/temp
  plus a small *fixed* deterministic jitter (so the grid looks populated and
  varied but never flickers randomly).
* All power is scaled to a headline ``FACILITY_IT_MW`` facility so the dashboard
  reads in MW/kW like a real datacenter. The scale is anchored so a fully-loaded
  sim == ``FACILITY_IT_MW`` of IT power. This is the same facility framing
  ``metrics.extrapolate_savings`` uses, keeping every number consistent.
* ``cluster.status`` is real: a cluster shows ``optimizing`` when the AI actually
  moved the setpoint this step, ``idle`` when its load is low, else ``active``.
"""

from __future__ import annotations

import numpy as np

import model
from metrics import FACILITY_IT_MW

# --- Layout ---
NODES_PER_ZONE = 8
CLUSTER_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"]

# --- Facility power scaling (sim watts -> facility watts) ---
# Anchor: a fully-loaded sim (every zone at P_MAX) equals FACILITY_IT_MW of IT.
_P_IT_MAX_W = model.N_ZONES * model.P_MAX_W  # 3200 W at the default constants
FACILITY_SCALE = (FACILITY_IT_MW * 1.0e6) / _P_IT_MAX_W  # W_sim -> W_facility
_KW_SCALE = FACILITY_SCALE / 1.0e3  # W_sim -> kW_facility
_MW_SCALE = FACILITY_SCALE / 1.0e6  # W_sim -> MW_facility

# Node visual-state thresholds (mirror the frontend's GPU-load buckets).
_HOT_LOAD = 75
_ACTIVE_LOAD = 30
_HOT_TEMP_C = model.T_MAX - 4.0  # a node within 4 C of the limit reads "hot"

# Geographic theming for the Mapbox cluster view (cosmetic; one site per cluster).
SITES = [
    {"site": "Houston, USA", "dataCenter": "North America Data Center", "lat": 29.7604, "lng": -95.3698},
    {"site": "Calgary, Canada", "dataCenter": "Canadian AI Hub", "lat": 51.0447, "lng": -114.0719},
    {"site": "Stavanger, Norway", "dataCenter": "Nordic Energy Cluster", "lat": 58.9700, "lng": 5.7331},
    {"site": "Doha, Qatar", "dataCenter": "MENA Operations Hub", "lat": 25.2854, "lng": 51.5310},
    {"site": "Perth, Australia", "dataCenter": "Asia-Pacific Cluster", "lat": -31.9505, "lng": 115.8605},
    {"site": "Jakarta, Indonesia", "dataCenter": "Indonesia Field Systems", "lat": -6.2088, "lng": 106.8456},
    {"site": "Anchorage, Alaska", "dataCenter": "Arctic Compute Node", "lat": 61.2181, "lng": -149.9003},
    {"site": "Beijing, China", "dataCenter": "China AI Operations", "lat": 39.9042, "lng": 116.4074},
]


def cooling_offset(t_supply: float) -> int:
    """Display-only cooling-vs-load offset (%) implied by the current setpoint.

    A warmer setpoint (the AI saving energy) reads as slightly *below* load; the
    cold baseline reads as matched/over-cooled. Clamped tight so cluster detail
    text stays in the calm "well matched / fine-tuning" band, never alarming.
    """
    return int(np.clip(round((model.T_SUPPLY_INIT - t_supply) * 3.0), -12, 12))


def build_nodes_and_clusters(
    util: np.ndarray,
    t_supply: float,
    ai_acting: bool,
    util_jitter: np.ndarray,
    temp_jitter: np.ndarray,
    spike_zones: set[int] | None = None,
    t_outside: float | None = None,
) -> tuple[list[dict], list[dict]]:
    """Build the ``nodes`` and ``clusters`` arrays from real per-zone state."""
    spike_zones = spike_zones or set()
    n = len(util)
    offset = cooling_offset(t_supply)
    cop = model.cop(t_supply, t_outside)

    nodes: list[dict] = []
    clusters: list[dict] = []

    for i in range(n):
        letter = CLUSTER_LETTERS[i % len(CLUSTER_LETTERS)]
        node_loads: list[int] = []
        node_coolings: list[int] = []
        node_power_kw_sum = 0.0

        for j in range(NODES_PER_ZONE):
            node_util = float(np.clip(util[i] + util_jitter[i, j], 0.0, 1.0))
            node_gpu = int(round(node_util * 100))
            node_p_it = float(model.it_power(np.array([node_util]))[0])
            node_temp = t_supply + model.R_TH * node_p_it + float(temp_jitter[i, j])
            node_cooling = int(np.clip(node_gpu + offset, 0, 100))
            node_power_kw = (node_p_it + node_p_it / cop) * _KW_SCALE

            if node_gpu > _HOT_LOAD or node_temp > _HOT_TEMP_C:
                state = "hot"
            elif node_gpu > _ACTIVE_LOAD:
                state = "active"
            else:
                state = "idle"

            nodes.append({
                "id": i * NODES_PER_ZONE + j + 1,
                "label": f"{letter}{j + 1}",
                "clusterName": letter,
                "state": state,
                "gpuLoad": node_gpu,
                "temperature": f"{node_temp:.1f}",
                "cooling": node_cooling,
                "powerUsage": round(node_power_kw, 2),
                "status": "online",
            })
            node_loads.append(node_gpu)
            node_coolings.append(node_cooling)
            node_power_kw_sum += node_power_kw

        avg_gpu = int(round(float(np.mean(node_loads))))
        avg_cooling = int(round(float(np.mean(node_coolings))))
        if avg_gpu < _ACTIVE_LOAD:
            status = "idle"
        elif ai_acting:
            status = "optimizing"
        else:
            status = "active"

        site = SITES[i % len(SITES)]
        clusters.append({
            "name": f"Cluster {letter}",
            "status": status,
            "gpu": avg_gpu,
            "cooling": avg_cooling,
            "power": round(node_power_kw_sum, 2),
            "site": site["site"],
            "dataCenter": site["dataCenter"],
            "lat": site["lat"],
            "lng": site["lng"],
            "spikeActive": i in spike_zones,
        })

    return nodes, clusters


def build_snapshot(
    util: np.ndarray,
    t_supply: float,
    pue: float,
    p_it_total_w: float,
    p_cool_w: float,
    ai_acting: bool,
    energy_savings_pct: float,
    co2_offset_kg: float,
    chart: dict,
    util_jitter: np.ndarray,
    temp_jitter: np.ndarray,
    timestamp_ms: int,
    spike_zones: set[int] | None = None,
    t_outside: float | None = None,
    outside_air_c: float | None = None,
    pue_in_band: bool | None = None,
) -> dict:
    """Assemble the full ``TelemetrySnapshot`` payload consumed by the frontend."""
    nodes, clusters = build_nodes_and_clusters(
        util, t_supply, ai_acting, util_jitter, temp_jitter, spike_zones, t_outside
    )
    power_draw_mw = (p_it_total_w + p_cool_w) * _MW_SCALE

    stats = {
        "energySavings": round(max(0.0, float(energy_savings_pct)), 1),
        "co2OffsetKg": int(round(max(0.0, float(co2_offset_kg)))),
        "powerDrawMW": round(float(power_draw_mw), 2),
        "coolingPUE": round(float(pue), 2),
    }
    # Realism extras (frontend renders them when present; harmless if ignored).
    if outside_air_c is not None:
        stats["outsideAirC"] = round(float(outside_air_c), 1)
    if pue_in_band is not None:
        stats["pueInBand"] = bool(pue_in_band)

    return {
        "timestamp": int(timestamp_ms),
        "stats": stats,
        "chart": chart,
        "clusters": clusters,
        "nodes": nodes,
    }
