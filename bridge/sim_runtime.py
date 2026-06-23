"""bridge/sim_runtime.py --- lockstep baseline-vs-AI simulation driver.

Holds two :class:`env.DCTwinEnv` instances seeded identically (so they see the
exact same workload) and steps them in lockstep: a :class:`FixedController`
(the 20 C baseline) and the trained AI (PPO, with a greedy-safe fallback). Each
tick it advances a few simulated minutes, accumulates the real energy/PUE/
violation numbers, and exposes a ThermaMind ``TelemetrySnapshot`` plus the live
baseline-vs-AI comparison. This is the same lockstep idea as dashboard.py, served
over the wire for the React dashboard.
"""

from __future__ import annotations

import time
from collections import deque

import numpy as np

import model
from baselines import FixedController
from env import DCTwinEnv
from metrics import (
    CO2_KG_PER_KWH,
    PUE_PUBLISHED_HIGH,
    PUE_PUBLISHED_LOW,
    EpisodeResult,
    compare,
)
from train import load_ai_controller
from workload import WorkloadStep

from bridge.adapter import FACILITY_SCALE, NODES_PER_ZONE, build_snapshot

_ACT_EPS = 0.05  # setpoint move (degC) above which the AI counts as "optimizing"


class SimRuntime:
    """Drives the baseline and AI twins together and emits telemetry snapshots."""

    def __init__(
        self,
        seed: int = 0,
        horizon: int = 1440,
        ai_prefer: str = "auto",
        steps_per_tick: int = 3,
        source: str = "synthetic",
        outside_air: bool = True,
    ) -> None:
        self.seed = int(seed)
        self.horizon = int(horizon)
        self.steps_per_tick = int(steps_per_tick)
        self.n = model.N_ZONES
        self.source = str(source)
        self.outside_air = bool(outside_air)

        self.base_env = DCTwinEnv(
            source=source, horizon=horizon, seed=seed, outside_air=outside_air
        )
        self.ai_env = DCTwinEnv(
            source=source, horizon=horizon, seed=seed, outside_air=outside_air
        )
        self.baseline = FixedController()
        self.ai = load_ai_controller(prefer=ai_prefer)
        self.ai_kind = "PPO" if type(self.ai).__name__ == "PPOController" else "Greedy-Safe"

        # Fixed deterministic per-node jitter so the 64-node grid looks varied
        # but never flickers between ticks.
        rng = np.random.default_rng(seed)
        self.util_jitter = rng.uniform(-0.05, 0.05, size=(self.n, NODES_PER_ZONE)).astype(np.float32)
        self.temp_jitter = rng.uniform(-0.8, 0.8, size=(self.n, NODES_PER_ZONE)).astype(np.float32)

        self.reset()

    # --- lifecycle ---
    def reset(self) -> None:
        self.base_obs, base_info = self.base_env.reset(seed=self.seed)
        self.ai_obs, ai_info = self.ai_env.reset(seed=self.seed)
        self.baseline.reset()
        self.ai.reset()

        self.steps = 0
        self.base_pue_sum = 0.0
        self.ai_pue_sum = 0.0
        self.base_cool_kwh = 0.0
        self.ai_cool_kwh = 0.0
        self.base_energy = 0.0
        self.ai_energy = 0.0
        self.last_base_info = base_info
        self.last_ai_info = ai_info
        self.ai_util = self.ai_env._last_util.copy()
        self.t_supply = float(ai_info["t_supply"])
        self.outside_air_c = float(ai_info.get("t_outside", model.T_OUTSIDE_REF_C))
        self.ai_acting = False

        self.chart = deque(maxlen=20)  # (label, gpu%, cooling%, savings%)
        self.spike_zones: set[int] = set()
        self.spike_remaining = 0

    # --- stepping ---
    def step_once(self) -> None:
        """Advance both twins by exactly one simulated minute."""
        if self.steps >= self.horizon:
            self.reset()

        a_base = self.baseline(self.base_obs)
        a_ai = self.ai(self.ai_obs)

        prev_sp = self.ai_env.t_supply
        self.base_obs, _, _, b_trunc, b_info = self.base_env.step(a_base)
        self.ai_obs, _, _, a_trunc, a_info = self.ai_env.step(a_ai)

        self.steps += 1
        self.base_pue_sum += b_info["pue"]
        self.ai_pue_sum += a_info["pue"]
        self.base_cool_kwh += (b_info["p_cool_w"] / 1000.0) * model.DT_HOURS
        self.ai_cool_kwh += (a_info["p_cool_w"] / 1000.0) * model.DT_HOURS
        self.base_energy = float(b_info["energy_kWh"])
        self.ai_energy = float(a_info["energy_kWh"])
        self.last_base_info = b_info
        self.last_ai_info = a_info
        self.ai_util = self.ai_env._last_util.copy()
        self.t_supply = float(a_info["t_supply"])
        self.outside_air_c = float(a_info.get("t_outside", model.T_OUTSIDE_REF_C))
        self.ai_acting = abs(self.t_supply - prev_sp) > _ACT_EPS

        if self.spike_remaining > 0:
            self.spike_remaining -= 1
            if self.spike_remaining == 0:
                self.spike_zones = set()

        cmp = self.comparison()
        minute = self.steps % 1440
        self.chart.append((
            f"{minute // 60:02d}:{minute % 60:02d}",
            round(float(np.mean(self.ai_util)) * 100, 1),
            round((model.T_SUPPLY_MAX - self.t_supply)
                  / (model.T_SUPPLY_MAX - model.T_SUPPLY_MIN) * 100, 1),
            round(max(0.0, cmp["pct_cooling_saved"]), 1),
        ))

    def tick(self) -> dict:
        """Advance ``steps_per_tick`` minutes and return a telemetry snapshot."""
        for _ in range(self.steps_per_tick):
            self.step_once()
        return self.snapshot()

    # --- live comparison ---
    def comparison(self) -> dict:
        steps = max(1, self.steps)
        base_res = EpisodeResult(
            energy_kWh=self.base_energy,
            avg_pue=self.base_pue_sum / steps,
            thermal_violations=int(self.last_base_info["thermal_violations"]),
            sla_violations=int(self.last_base_info["sla_violations"]),
            steps=self.steps,
            cooling_kWh=self.base_cool_kwh,
        )
        ai_res = EpisodeResult(
            energy_kWh=self.ai_energy,
            avg_pue=self.ai_pue_sum / steps,
            thermal_violations=int(self.last_ai_info["thermal_violations"]),
            sla_violations=int(self.last_ai_info["sla_violations"]),
            steps=self.steps,
            cooling_kWh=self.ai_cool_kwh,
        )
        c = compare(base_res, ai_res)
        if not np.isfinite(c.get("pct_cooling_saved", float("nan"))):
            c["pct_cooling_saved"] = 0.0
        return c

    # --- snapshot ---
    def _chart_payload(self) -> dict:
        labels = [row[0] for row in self.chart]
        return {
            "labels": labels,
            "datasets": [
                {"label": "GPU Utilization %", "data": [row[1] for row in self.chart]},
                {"label": "Cooling Power %", "data": [row[2] for row in self.chart]},
                {"label": "Energy Savings %", "data": [row[3] for row in self.chart]},
            ],
        }

    def snapshot(self) -> dict:
        cmp = self.comparison()
        co2_kg = max(0.0, (self.base_energy - self.ai_energy) * FACILITY_SCALE * CO2_KG_PER_KWH)
        pue = float(self.last_ai_info["pue"])
        pue_in_band = bool(PUE_PUBLISHED_LOW <= pue <= PUE_PUBLISHED_HIGH)
        return build_snapshot(
            util=self.ai_util,
            t_supply=self.t_supply,
            pue=pue,
            p_it_total_w=float(self.last_ai_info["p_it_total_w"]),
            p_cool_w=float(self.last_ai_info["p_cool_w"]),
            ai_acting=self.ai_acting,
            energy_savings_pct=cmp["pct_cooling_saved"],
            co2_offset_kg=co2_kg,
            chart=self._chart_payload(),
            util_jitter=self.util_jitter,
            temp_jitter=self.temp_jitter,
            timestamp_ms=int(time.time() * 1000),
            spike_zones=self.spike_zones,
            t_outside=self.outside_air_c,
            outside_air_c=self.outside_air_c,
            pue_in_band=pue_in_band,
        )

    # --- interactive controls ---
    def inject_spike(self, magnitude: float = 1.6, duration: int = 60, zones=None) -> dict:
        """Boost upcoming workload for a window, identically in both twins."""
        zone_set = set(range(self.n)) if zones is None else {int(z) for z in zones}
        mag = float(magnitude)
        for env in (self.base_env, self.ai_env):
            wl = env._workload
            for k in range(env.t, min(env.t + int(duration), len(wl))):
                s = wl[k]
                util = s.util.copy()
                for z in zone_set:
                    util[z] = min(1.0, float(util[z]) * mag)
                wl[k] = WorkloadStep(util=util.astype(np.float32), arrivals=float(s.arrivals) * mag)
        self.spike_zones = zone_set
        self.spike_remaining = int(duration)
        return {"ok": True, "zones": sorted(zone_set), "magnitude": mag, "duration": int(duration)}

    def status_summary(self) -> dict:
        """Compact, real telemetry context for the offline assistant."""
        cmp = self.comparison()
        util = np.asarray(self.ai_util, dtype=float)
        temps = np.asarray(self.last_ai_info["temps"], dtype=float)
        from bridge.adapter import CLUSTER_LETTERS

        hottest = int(np.argmax(temps))
        busiest = int(np.argmax(util))
        coolest = int(np.argmin(util))
        pue = float(self.last_ai_info["pue"])
        return {
            "ai_kind": self.ai_kind,
            "t_supply": self.t_supply,
            "pue": pue,
            "outside_air_c": float(self.outside_air_c),
            "pue_in_band": bool(PUE_PUBLISHED_LOW <= pue <= PUE_PUBLISHED_HIGH),
            "mean_util_pct": float(np.mean(util) * 100),
            "pct_cooling_saved": float(cmp["pct_cooling_saved"]),
            "delta_pue": float(cmp["delta_pue"]),
            "thermal_violations": int(self.last_ai_info["thermal_violations"]),
            "sla_delta": int(cmp["sla_delta"]),
            "power_draw_mw": (float(self.last_ai_info["p_it_total_w"])
                              + float(self.last_ai_info["p_cool_w"])) * (FACILITY_SCALE / 1e6),
            "hottest": {"cluster": CLUSTER_LETTERS[hottest], "temp_c": float(temps[hottest]),
                        "load_pct": float(util[hottest] * 100)},
            "busiest": {"cluster": CLUSTER_LETTERS[busiest], "load_pct": float(util[busiest] * 100)},
            "coolest": {"cluster": CLUSTER_LETTERS[coolest], "load_pct": float(util[coolest] * 100)},
        }
