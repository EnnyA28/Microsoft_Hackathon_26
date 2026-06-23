"""model.py --- Contract D: datacenter physics + constants.

Single source of truth for every physical number in DC-Twin. Every other module
imports the constants and pure functions defined here and never hard-codes a
physical value of its own.

Physics summary (see AGENTS.md Section 7)
-----------------------------------------
Power model (per zone), watts:
    P_it_i   = P_IDLE + (P_MAX - P_IDLE) * u_i
    P_it_tot = sum_i(P_it_i)

Thermal model (per zone), degrees C:
    T_i      = T_supply + R_TH * P_it_i

Cooling model:
    COP      = COP_A + COP_B * T_supply      # higher setpoint -> higher COP -> cheaper
    Q        = P_it_tot                       # all IT power becomes heat to remove
    P_cool   = Q / COP

Energy + efficiency:
    P_total  = P_it_tot + P_cool
    PUE      = P_total / P_it_tot             # == 1 + 1/COP
    E_step   = P_total * dt_hours             # kWh when P expressed in kW

Constant justification (vs published ranges)
--------------------------------------------
Hyperscale datacenters report PUE in the 1.1-1.6 band and chiller/CRAH COP in the
3-6 band. With the defaults below COP(20 C) = 4.1 -> PUE = 1.24 and COP(27 C) = 5.5
-> PUE = 1.18, both inside the published envelope. A fully loaded zone draws 400 W
and a thermal resistance of 0.02 C/W yields an 8 C rise, so the warm end of the
setpoint range (27 C) pushes a busy zone to 35 C (a violation) while the cold end
(18 C) keeps it at 26 C. That gap is exactly the safety-vs-efficiency trade-off the
controller must learn to exploit.
"""

from __future__ import annotations

import numpy as np

# --- Contract D: physics constants (owned here; imported everywhere else) ---
N_ZONES = 8  # number of independently-modelled rack zones
P_IDLE_W = 150.0  # idle power per zone (W)
P_MAX_W = 400.0  # max power per zone (W)
R_TH = 0.02  # thermal resistance (degC per W)
COP_A = 0.10  # COP intercept
COP_B = 0.20  # COP slope vs T_supply  (COP = COP_A + COP_B * T_supply)
T_MAX = 32.0  # thermal violation threshold (degC) -- never exceed
T_SUPPLY_MIN = 18.0  # coolest allowed setpoint (degC)
T_SUPPLY_MAX = 27.0  # warmest allowed setpoint (degC)
T_SUPPLY_INIT = 20.0  # baseline fixed setpoint (degC)
MAX_DELTA_C = 1.0  # max setpoint change per step (degC)
DT_HOURS = 1.0 / 60.0  # one step = 1 minute

# --- Outside-air economizer (optional). The base COP curve is unchanged unless a
# t_outside is supplied, so every existing result is preserved. Cooler outside air
# lets the plant reject heat more cheaply -> higher COP -> lower PUE. ---
T_OUTSIDE_REF_C = 20.0   # outside-air temp at which the base COP curve holds exactly
COP_OUTSIDE_K = 0.05     # COP gain per degC that outside air is below the reference
COP_MIN = 2.0            # COP floor, keeps PUE physically sane on the hottest days
T_OUTSIDE_MEAN_C = 18.0  # diurnal outside-air mean (a temperate region)
T_OUTSIDE_AMPL_C = 8.0   # diurnal swing (coolest ~05:00, warmest ~17:00)


def it_power(util: np.ndarray) -> np.ndarray:
    """Per-zone IT power in watts for a vector of utilizations in [0, 1]."""
    util = np.asarray(util, dtype=np.float64)
    return P_IDLE_W + (P_MAX_W - P_IDLE_W) * util


def zone_temps(t_supply: float, p_it: np.ndarray) -> np.ndarray:
    """Per-zone temperature (degC) given the supply setpoint and per-zone power."""
    p_it = np.asarray(p_it, dtype=np.float64)
    return t_supply + R_TH * p_it


def cop(t_supply: float, t_outside: float | None = None) -> float:
    """Coefficient of performance of the cooling plant at a supply setpoint.

    Rises with ``t_supply`` (warmer cold-air is cheaper to produce). If an
    outside-air temperature is supplied, an economizer term makes cooling cheaper
    when it is cold outside and dearer when it is hot. ``t_outside=None``
    reproduces the original curve exactly, so existing results are unchanged.
    """
    base = COP_A + COP_B * t_supply
    if t_outside is not None:
        base += COP_OUTSIDE_K * (T_OUTSIDE_REF_C - float(t_outside))
    return float(max(COP_MIN, base))


def cooling_power(
    p_it_total: float, t_supply: float, t_outside: float | None = None
) -> float:
    """Electrical power (W) the cooling plant draws to remove ``p_it_total`` heat."""
    return float(p_it_total) / cop(t_supply, t_outside)


def totals(
    p_it: np.ndarray, t_supply: float, t_outside: float | None = None
) -> tuple[float, float, float]:
    """Aggregate (P_it_tot, P_cool, PUE) for per-zone power at a setpoint.

    Returns
    -------
    p_it_total : float
        Total IT power in watts.
    p_cool : float
        Cooling power in watts.
    pue : float
        Power Usage Effectiveness, == 1 + 1 / COP(t_supply, t_outside).
    """
    p_it = np.asarray(p_it, dtype=np.float64)
    p_it_total = float(p_it.sum())
    p_cool = cooling_power(p_it_total, t_supply, t_outside)
    p_total = p_it_total + p_cool
    pue = p_total / p_it_total if p_it_total > 0 else float("nan")
    return p_it_total, p_cool, pue


def outside_air_temp(
    t_minute: float,
    horizon: int = 1440,
    mean_c: float = T_OUTSIDE_MEAN_C,
    ampl_c: float = T_OUTSIDE_AMPL_C,
) -> float:
    """Diurnal outside-air temperature (degC): coolest ~05:00, warmest ~17:00.

    A simple sinusoid over a ``horizon``-minute day. Used by the env (and the web
    bridge) so the cooling COP -- and therefore PUE -- varies with time of day the
    way a real economized facility does.
    """
    frac = (float(t_minute) % horizon) / horizon  # 0..1 across the day
    return float(mean_c - ampl_c * np.cos(2.0 * np.pi * (frac - 5.0 / 24.0)))


def step_energy_kwh(p_total_w: float, dt_hours: float = DT_HOURS) -> float:
    """Energy in kWh consumed over ``dt_hours`` at a constant total power (W)."""
    return (float(p_total_w) / 1000.0) * dt_hours


def _validation_chart(path: str = "validation_tradeoff.png") -> str:
    """Save the setpoint trade-off chart and return the output path.

    Shows that as T_supply rises 18->27 C, cooling power falls while the hottest
    zone temperature climbs toward (and past) T_MAX -- proving the trade-off exists.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    setpoints = np.linspace(T_SUPPLY_MIN, T_SUPPLY_MAX, 50)
    full_load = np.ones(N_ZONES)  # worst case: every zone maxed out
    p_it = it_power(full_load)
    p_cool = np.array([cooling_power(p_it.sum(), ts) for ts in setpoints])
    max_temp = np.array([zone_temps(ts, p_it).max() for ts in setpoints])

    fig, ax_left = plt.subplots(figsize=(8, 5))
    color_cool = "tab:blue"
    ax_left.set_xlabel("Supply setpoint T_supply (degC)")
    ax_left.set_ylabel("Cooling power P_cool (W)", color=color_cool)
    ax_left.plot(setpoints, p_cool, color=color_cool, linewidth=2, label="P_cool")
    ax_left.tick_params(axis="y", labelcolor=color_cool)

    ax_right = ax_left.twinx()
    color_temp = "tab:red"
    ax_right.set_ylabel("Hottest zone temp (degC)", color=color_temp)
    ax_right.plot(setpoints, max_temp, color=color_temp, linewidth=2, label="max(T_i)")
    ax_right.axhline(T_MAX, color="black", linestyle="--", linewidth=1, label="T_MAX")
    ax_right.tick_params(axis="y", labelcolor=color_temp)

    fig.suptitle("Setpoint trade-off at full load: cheaper cooling vs. hotter zones")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


if __name__ == "__main__":
    # --- Test alone (AGENTS.md Section 9) ---
    # cooling_power must fall as the setpoint rises.
    full = it_power(np.ones(N_ZONES))
    p_cool_cold = cooling_power(full.sum(), T_SUPPLY_MIN)
    p_cool_warm = cooling_power(full.sum(), T_SUPPLY_MAX)
    assert p_cool_warm < p_cool_cold, "cooling power should drop as setpoint rises"

    # PUE must stay in a physically sane band for the whole setpoint range.
    for ts in np.linspace(T_SUPPLY_MIN, T_SUPPLY_MAX, 10):
        _, _, pue = totals(full, ts)
        assert 1.0 < pue < 2.0, f"PUE out of band at {ts}C: {pue}"

    # Print a quick sanity table.
    print(f"{'T_supply':>9} {'COP':>6} {'PUE':>6} {'P_cool(W)':>10} {'maxT(C)':>8}")
    for ts in (18.0, 20.0, 23.0, 27.0):
        p_it_tot, p_cool, pue = totals(full, ts)
        max_t = zone_temps(ts, full).max()
        print(f"{ts:9.1f} {cop(ts):6.2f} {pue:6.3f} {p_cool:10.1f} {max_t:8.2f}")

    out = _validation_chart()
    print(f"\nValidation chart saved to {out}")
    print("model.py self-test passed.")
