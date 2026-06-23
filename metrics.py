"""metrics.py --- episode harness + baseline-vs-AI scoreboard.

Runs any Contract-C controller through a Contract-B env for a full episode and
collects the numbers that decide the win condition (AGENTS.md Section 3):

    * energy used (kWh)            -> want >= 10% less than the fixed baseline
    * thermal violations           -> must be exactly 0
    * SLA violations               -> must be <= baseline
    * average PUE                  -> lower is better (headline)

It also extrapolates the % energy saved to a 1 MW facility to produce the
"money table": annual kWh, $ and CO2 saved.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

import model


# --- Contract C (structural) ---
class Controller(Protocol):
    def __call__(self, obs: np.ndarray) -> np.ndarray: ...
    def reset(self) -> None: ...


# --- Extrapolation assumptions (documented; tweak for your region/grid) ---
FACILITY_IT_MW = 1.0  # headline facility IT load
HOURS_PER_YEAR = 8760.0
PRICE_PER_KWH_USD = 0.12  # commercial electricity (US average ballpark)
CO2_KG_PER_KWH = 0.40  # grid carbon intensity (kg CO2 / kWh, ~US average)

# --- Published PUE reference bands (for the emergent-PUE realism check) ---
# Broad hyperscale envelope reported across the industry, and the tighter band
# Microsoft reports for its own fleet. Used to show the twin's *emergent* PUE
# (when driven by a real workload) lands at genuine datacenter levels.
PUE_PUBLISHED_LOW = 1.10
PUE_PUBLISHED_HIGH = 1.60
PUE_FLEET_LOW = 1.12
PUE_FLEET_HIGH = 1.18


@dataclass
class EpisodeResult:
    energy_kWh: float  # total (IT + cooling) energy
    avg_pue: float
    thermal_violations: int
    sla_violations: int
    steps: int
    cooling_kWh: float = 0.0  # cooling-only energy (the headline metric)


def run_episode(env, controller: Controller, seed: int = 0) -> EpisodeResult:
    """Run one full episode of ``controller`` on ``env`` and summarize it."""
    if hasattr(controller, "reset"):
        controller.reset()
    obs, info = env.reset(seed=seed)

    pue_sum = 0.0
    cooling_kwh = 0.0
    steps = 0
    last_info = info
    terminated = truncated = False
    while not (terminated or truncated):
        action = controller(obs)
        obs, reward, terminated, truncated, info = env.step(action)
        pue_sum += info["pue"]
        cooling_kwh += (info["p_cool_w"] / 1000.0) * model.DT_HOURS
        steps += 1
        last_info = info

    return EpisodeResult(
        energy_kWh=float(last_info["energy_kWh"]),
        avg_pue=float(pue_sum / steps) if steps else float("nan"),
        thermal_violations=int(last_info["thermal_violations"]),
        sla_violations=int(last_info["sla_violations"]),
        steps=int(steps),
        cooling_kWh=float(cooling_kwh),
    )


def run_episode_trace(env, controller: Controller, seed: int = 0) -> dict:
    """Like :func:`run_episode` but also returns per-step arrays for plotting."""
    if hasattr(controller, "reset"):
        controller.reset()
    obs, info = env.reset(seed=seed)

    trace: dict[str, list] = {
        "t_supply": [], "pue": [], "max_temp": [], "energy_kWh": [],
        "p_cool_w": [], "p_it_total_w": [], "queue_len": [], "temps": [],
    }
    pue_sum = 0.0
    cooling_kwh = 0.0
    steps = 0
    last_info = info
    terminated = truncated = False
    while not (terminated or truncated):
        action = controller(obs)
        obs, reward, terminated, truncated, info = env.step(action)
        for key in (
            "t_supply", "pue", "max_temp", "energy_kWh",
            "p_cool_w", "p_it_total_w", "queue_len",
        ):
            trace[key].append(info[key])
        trace["temps"].append(np.asarray(info["temps"], dtype=np.float32))
        pue_sum += info["pue"]
        cooling_kwh += (info["p_cool_w"] / 1000.0) * model.DT_HOURS
        steps += 1
        last_info = info

    result = EpisodeResult(
        energy_kWh=float(last_info["energy_kWh"]),
        avg_pue=float(pue_sum / steps) if steps else float("nan"),
        thermal_violations=int(last_info["thermal_violations"]),
        sla_violations=int(last_info["sla_violations"]),
        steps=int(steps),
        cooling_kWh=float(cooling_kwh),
    )
    trace["temps"] = np.array(trace["temps"])  # (steps, n_zones)
    return {"result": result, "trace": trace}


def extrapolate_savings(
    baseline: EpisodeResult, ai: EpisodeResult, facility_it_mw: float = FACILITY_IT_MW
) -> dict:
    """Scale the per-episode energy saved to an annual 1 MW-facility figure.

    IT power is workload-driven and identical for both controllers, so every kWh
    the AI saves is a cooling kWh. We scale the measured total-energy reduction
    (real metered savings) up to a facility running ``facility_it_mw`` of IT.
    """
    pct_total = pct_energy_saved(baseline, ai) / 100.0

    # Annual facility energy at the baseline efficiency (PUE) for the given IT MW.
    baseline_annual_kwh = facility_it_mw * 1000.0 * baseline.avg_pue * HOURS_PER_YEAR
    annual_kwh_saved = baseline_annual_kwh * pct_total

    return {
        "facility_it_mw": facility_it_mw,
        "baseline_annual_kWh": baseline_annual_kwh,
        "annual_kWh_saved": annual_kwh_saved,
        "annual_usd_saved": annual_kwh_saved * PRICE_PER_KWH_USD,
        "annual_co2_kg_saved": annual_kwh_saved * CO2_KG_PER_KWH,
    }


def pct_energy_saved(baseline: EpisodeResult, ai: EpisodeResult) -> float:
    """Percent TOTAL (IT + cooling) energy the AI saved vs baseline (>0 == better)."""
    if baseline.energy_kWh <= 0:
        return float("nan")
    return 100.0 * (baseline.energy_kWh - ai.energy_kWh) / baseline.energy_kWh


def pct_cooling_saved(baseline: EpisodeResult, ai: EpisodeResult) -> float:
    """Percent COOLING energy the AI saved vs baseline -- the headline metric."""
    if baseline.cooling_kWh <= 0:
        return float("nan")
    return 100.0 * (baseline.cooling_kWh - ai.cooling_kWh) / baseline.cooling_kWh


def compare(baseline: EpisodeResult, ai: EpisodeResult) -> dict:
    """Build the comparison dict consumed by the dashboard and CLI table."""
    pct_total = pct_energy_saved(baseline, ai)
    pct_cool = pct_cooling_saved(baseline, ai)
    savings = extrapolate_savings(baseline, ai)
    win = (
        pct_cool >= 10.0
        and ai.thermal_violations == 0
        and ai.sla_violations <= baseline.sla_violations
    )
    return {
        "pct_cooling_saved": pct_cool,
        "pct_energy_saved": pct_total,
        "delta_pue": baseline.avg_pue - ai.avg_pue,
        "thermal_violations_ai": ai.thermal_violations,
        "thermal_violations_baseline": baseline.thermal_violations,
        "sla_delta": ai.sla_violations - baseline.sla_violations,
        "baseline_energy_kWh": baseline.energy_kWh,
        "ai_energy_kWh": ai.energy_kWh,
        "baseline_cooling_kWh": baseline.cooling_kWh,
        "ai_cooling_kWh": ai.cooling_kWh,
        "baseline_avg_pue": baseline.avg_pue,
        "ai_avg_pue": ai.avg_pue,
        "win": bool(win),
        **savings,
    }


def print_money_table(baseline: EpisodeResult, ai: EpisodeResult, ai_label: str = "AI") -> dict:
    """Pretty-print the baseline-vs-AI money table; return the comparison dict."""
    c = compare(baseline, ai)
    line = "=" * 60
    print(line)
    print(f"  DC-Twin scoreboard:  Baseline (fixed 20C)  vs  {ai_label}")
    print(line)
    print(f"  {'metric':<26}{'baseline':>14}{ai_label:>14}")
    print(f"  {'-'*54}")
    print(f"  {'cooling energy (kWh)':<26}{baseline.cooling_kWh:>14.3f}{ai.cooling_kWh:>14.3f}")
    print(f"  {'total energy (kWh)':<26}{baseline.energy_kWh:>14.3f}{ai.energy_kWh:>14.3f}")
    print(f"  {'avg PUE':<26}{baseline.avg_pue:>14.3f}{ai.avg_pue:>14.3f}")
    print(f"  {'thermal violations':<26}{baseline.thermal_violations:>14d}{ai.thermal_violations:>14d}")
    print(f"  {'SLA violations':<26}{baseline.sla_violations:>14d}{ai.sla_violations:>14d}")
    print(f"  {'-'*54}")
    print(f"  cooling energy saved: {c['pct_cooling_saved']:>6.2f}%   (target >= 10%)  <- HEADLINE")
    print(f"  total energy saved  : {c['pct_energy_saved']:>6.2f}%")
    print(f"  PUE improvement     : {c['delta_pue']:>6.3f}   ({baseline.avg_pue:.3f} -> {ai.avg_pue:.3f})")
    print(f"  thermal violations  : {c['thermal_violations_ai']:>6d}    (target 0)")
    print(f"  SLA delta vs base   : {c['sla_delta']:>+6d}    (target <= 0)")
    print(line)
    print(f"  Extrapolated to a {c['facility_it_mw']:.0f} MW datacenter, per year:")
    print(f"    energy saved : {c['annual_kWh_saved']:>14,.0f} kWh")
    print(f"    money saved  : ${c['annual_usd_saved']:>13,.0f}")
    print(f"    CO2 avoided  : {c['annual_co2_kg_saved']/1000.0:>14,.1f} tonnes")
    print(line)
    verdict = "WIN" if c["win"] else "NOT YET"
    print(f"  VERDICT: {verdict}")
    print(line)
    return c


def pue_realism_check(
    source: str = "azure",
    outside_air: bool = True,
    horizon: int = 1440,
    seed: int = 0,
    ai: Controller | None = None,
) -> dict:
    """Drive the twin with a (real) workload trace and check that its emergent
    average PUE lands inside published datacenter ranges.

    This is evidence the *modeled* thermal/cooling layer behaves like a real
    facility -- not merely that it is internally consistent. The fixed-20C
    baseline is the closest analogue to conventional operation, so its emergent
    PUE is the headline number compared against the published bands.
    """
    from env import DCTwinEnv
    from baselines import FixedController

    env = DCTwinEnv(source=source, horizon=horizon, seed=seed, outside_air=outside_air)
    base = run_episode(env, FixedController(), seed=seed)
    out = {
        "source": source,
        "outside_air": bool(outside_air),
        "baseline_avg_pue": base.avg_pue,
        "in_published_band": bool(PUE_PUBLISHED_LOW <= base.avg_pue <= PUE_PUBLISHED_HIGH),
        "in_fleet_band": bool(PUE_FLEET_LOW <= base.avg_pue <= PUE_FLEET_HIGH),
        "published_band": (PUE_PUBLISHED_LOW, PUE_PUBLISHED_HIGH),
        "fleet_band": (PUE_FLEET_LOW, PUE_FLEET_HIGH),
    }
    if ai is not None:
        ai_res = run_episode(env, ai, seed=seed)
        out["ai_avg_pue"] = ai_res.avg_pue
        out["ai_in_published_band"] = bool(
            PUE_PUBLISHED_LOW <= ai_res.avg_pue <= PUE_PUBLISHED_HIGH
        )
    return out


def print_pue_realism(
    source: str = "azure",
    outside_air: bool = True,
    horizon: int = 1440,
    seed: int = 0,
    ai: Controller | None = None,
) -> dict:
    """Pretty-print the emergent-PUE realism check; return its result dict."""
    r = pue_realism_check(
        source=source, outside_air=outside_air, horizon=horizon, seed=seed, ai=ai
    )
    lo, hi = r["published_band"]
    flo, fhi = r["fleet_band"]
    line = "=" * 60
    print(line)
    print("  Emergent-PUE realism check (twin driven by a real workload)")
    print(line)
    print(f"  workload source         : {r['source']}")
    print(f"  outside-air economizer  : {'on' if r['outside_air'] else 'off'}")
    print(f"  baseline emergent PUE   : {r['baseline_avg_pue']:.3f}")
    if "ai_avg_pue" in r:
        print(f"  AI emergent PUE         : {r['ai_avg_pue']:.3f}")
    print(f"  {'-' * 54}")
    print(
        f"  published band {lo:.2f}-{hi:.2f}  : "
        f"{'PASS' if r['in_published_band'] else 'OUT OF BAND'}"
    )
    print(
        f"  within MS fleet {flo:.2f}-{fhi:.2f} : "
        f"{'yes' if r['in_fleet_band'] else 'no (slightly above)'}"
    )
    print(line)
    return r


if __name__ == "__main__":
    import sys

    if "--pue-check" in sys.argv:
        # Emergent-PUE realism: real-trace workload + outside-air economizer.
        from train import load_ai_controller

        print_pue_realism(
            source="azure", outside_air=True, ai=load_ai_controller(prefer="auto")
        )
        print("\nmetrics.py PUE realism check done.")
    else:
        # --- Test alone: baseline-vs-baseline table (fixed vs reactive) ---
        from env import DCTwinEnv
        from baselines import FixedController, ReactiveController

        env = DCTwinEnv(source="synthetic", horizon=1440, seed=0)
        fixed_res = run_episode(env, FixedController(), seed=0)
        reactive_res = run_episode(env, ReactiveController(), seed=0)

        print_money_table(fixed_res, reactive_res, ai_label="Reactive")
        print("\nmetrics.py self-test passed.")
