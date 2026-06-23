"""dashboard.py --- Streamlit demo: Baseline vs AI, side by side.

Two columns stepped in lockstep through the same workload:
    left  = fixed-setpoint baseline (20 C)
    right = the AI (trained PPO if available, else the greedy-safe fallback)

Shows a zone-temperature heatmap, live energy + PUE, violation counters, and a
big headline metric (cooling energy saved, PUE drop, thermal violations). Runs
100% offline.

Run:
    streamlit run dashboard.py
"""

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go
import streamlit as st

import metrics
import model
from baselines import FixedController, ReactiveController
from env import DCTwinEnv
from metrics import EpisodeResult
from train import GreedySafeController, load_ai_controller

st.set_page_config(page_title="DC-Twin: Baseline vs AI", layout="wide")

HORIZON = 1440
N_ZONES = model.N_ZONES


# --- Simulation state -------------------------------------------------------
def _new_controller(kind: str):
    if kind == "PPO / fallback (auto)":
        return load_ai_controller(prefer="auto")
    if kind == "PPO (require trained)":
        return load_ai_controller(prefer="ppo")
    if kind == "Greedy-safe heuristic":
        return GreedySafeController()
    if kind == "Reactive":
        return ReactiveController()
    return FixedController()


def _blank_history() -> dict:
    return {
        "t_supply": [], "pue": [], "max_temp": [], "energy_kWh": [],
        "cooling_kWh": [], "thermal": [], "sla": [], "temps": None,
    }


def init_sim(ai_kind: str, source: str, seed: int) -> None:
    base_env = DCTwinEnv(source=source, horizon=HORIZON, seed=seed)
    ai_env = DCTwinEnv(source=source, horizon=HORIZON, seed=seed)
    base_obs, base_info = base_env.reset(seed=seed)
    ai_obs, ai_info = ai_env.reset(seed=seed)

    base_ctrl = FixedController()
    ai_ctrl = _new_controller(ai_kind)
    base_ctrl.reset()
    ai_ctrl.reset()

    st.session_state.sim = {
        "base_env": base_env, "ai_env": ai_env,
        "base_ctrl": base_ctrl, "ai_ctrl": ai_ctrl,
        "base_obs": base_obs, "ai_obs": ai_obs,
        "base_hist": _blank_history(), "ai_hist": _blank_history(),
        "base_cool": 0.0, "ai_cool": 0.0,
        "t": 0, "done": False, "playing": False,
        "ai_kind": ai_kind, "source": source, "seed": seed,
    }
    # Seed the heatmaps with the reset state.
    st.session_state.sim["base_hist"]["temps"] = base_info["temps"]
    st.session_state.sim["ai_hist"]["temps"] = ai_info["temps"]


def _advance(sim: dict, n_steps: int) -> None:
    dt = model.DT_HOURS
    for _ in range(n_steps):
        if sim["t"] >= HORIZON:
            sim["done"] = True
            break
        ba = sim["base_ctrl"](sim["base_obs"])
        aa = sim["ai_ctrl"](sim["ai_obs"])
        sim["base_obs"], _, _, bt, bi = sim["base_env"].step(ba)
        sim["ai_obs"], _, _, at, ai = sim["ai_env"].step(aa)

        sim["base_cool"] += (bi["p_cool_w"] / 1000.0) * dt
        sim["ai_cool"] += (ai["p_cool_w"] / 1000.0) * dt
        for hist, info, cool in (
            (sim["base_hist"], bi, sim["base_cool"]),
            (sim["ai_hist"], ai, sim["ai_cool"]),
        ):
            hist["t_supply"].append(info["t_supply"])
            hist["pue"].append(info["pue"])
            hist["max_temp"].append(info["max_temp"])
            hist["energy_kWh"].append(info["energy_kWh"])
            hist["cooling_kWh"].append(cool)
            hist["thermal"].append(info["thermal_violations"])
            hist["sla"].append(info["sla_violations"])
            hist["temps"] = info["temps"]

        sim["t"] += 1
        if bt or at:
            sim["done"] = True
            break


# --- Plot helpers -----------------------------------------------------------
def temp_heatmap(temps: np.ndarray, title: str) -> go.Figure:
    cols = 4
    rows = int(np.ceil(N_ZONES / cols))
    grid = np.full(rows * cols, np.nan)
    grid[:N_ZONES] = temps
    grid = grid.reshape(rows, cols)
    labels = [[f"{v:.1f}°C" if np.isfinite(v) else "" for v in row] for row in grid]
    fig = go.Figure(
        data=go.Heatmap(
            z=grid,
            zmin=model.T_SUPPLY_MIN,
            zmax=model.T_MAX,
            colorscale="RdYlBu_r",
            colorbar=dict(title="°C"),
            text=labels,
            texttemplate="%{text}",
            hovertemplate="%{z:.2f}°C<extra></extra>",
        )
    )
    fig.update_layout(
        title=title, height=240, margin=dict(l=10, r=10, t=40, b=10)
    )
    fig.update_xaxes(showticklabels=False)
    fig.update_yaxes(showticklabels=False, autorange="reversed")
    return fig


def line_compare(base_y, ai_y, title: str, y_title: str) -> go.Figure:
    fig = go.Figure()
    x = list(range(len(base_y)))
    fig.add_trace(go.Scatter(x=x, y=base_y, name="Baseline", line=dict(color="#888")))
    fig.add_trace(go.Scatter(x=x, y=ai_y, name="AI", line=dict(color="#2ca02c")))
    fig.update_layout(
        title=title, height=260, margin=dict(l=10, r=10, t=40, b=10),
        xaxis_title="step (min)", yaxis_title=y_title,
        legend=dict(orientation="h", y=1.15),
    )
    return fig


def _partial_result(hist: dict, cooling_kWh: float, steps: int) -> EpisodeResult:
    if steps == 0:
        return EpisodeResult(0.0, float("nan"), 0, 0, 0, 0.0)
    return EpisodeResult(
        energy_kWh=hist["energy_kWh"][-1],
        avg_pue=float(np.mean(hist["pue"])),
        thermal_violations=hist["thermal"][-1],
        sla_violations=hist["sla"][-1],
        steps=steps,
        cooling_kWh=cooling_kWh,
    )


# --- Sidebar controls -------------------------------------------------------
st.sidebar.title("DC-Twin controls")
ai_kind = st.sidebar.selectbox(
    "AI controller",
    ["PPO / fallback (auto)", "PPO (require trained)", "Greedy-safe heuristic", "Reactive"],
    index=0,
)
source = st.sidebar.selectbox("Workload", ["synthetic", "azure"], index=0)
seed = st.sidebar.number_input("Seed", min_value=0, max_value=9999, value=0, step=1)
speed = st.sidebar.slider("Steps per frame", 1, 60, 15)

need_init = (
    "sim" not in st.session_state
    or st.session_state.sim["ai_kind"] != ai_kind
    or st.session_state.sim["source"] != source
    or st.session_state.sim["seed"] != seed
)
if need_init:
    init_sim(ai_kind, source, int(seed))

c1, c2, c3 = st.sidebar.columns(3)
if c1.button("Play", use_container_width=True):
    st.session_state.sim["playing"] = True
if c2.button("Pause", use_container_width=True):
    st.session_state.sim["playing"] = False
if c3.button("Reset", use_container_width=True):
    init_sim(ai_kind, source, int(seed))
if st.sidebar.button("Run to end", use_container_width=True):
    _advance(st.session_state.sim, HORIZON)
    st.session_state.sim["playing"] = False

sim = st.session_state.sim

# Advance one frame if playing.
if sim["playing"] and not sim["done"]:
    _advance(sim, int(speed))


# --- Headline ---------------------------------------------------------------
st.title("DC-Twin: cooling AI vs fixed-setpoint baseline")

base_res = _partial_result(sim["base_hist"], sim["base_cool"], sim["t"])
ai_res = _partial_result(sim["ai_hist"], sim["ai_cool"], sim["t"])

if sim["t"] > 0:
    cmp = metrics.compare(base_res, ai_res)
    h1, h2, h3, h4 = st.columns(4)
    h1.metric(
        "Cooling energy saved",
        f"{cmp['pct_cooling_saved']:.1f}%",
        delta="target ≥ 10%",
        delta_color="off",
    )
    h2.metric(
        "PUE (baseline → AI)",
        f"{ai_res.avg_pue:.3f}",
        delta=f"{-cmp['delta_pue']:.3f}",
        delta_color="inverse",
    )
    h3.metric("Thermal violations (AI)", f"{ai_res.thermal_violations}")
    h4.metric("$ / year @ 1 MW", f"${cmp['annual_usd_saved']:,.0f}")
    progress = min(1.0, sim["t"] / HORIZON)
    st.progress(progress, text=f"step {sim['t']} / {HORIZON}  ({progress*100:.0f}% of one day)")
    if sim["done"]:
        verdict = "✅ WIN" if cmp["win"] else "⚠️ not yet"
        st.subheader(
            f"{verdict}  ·  {cmp['pct_cooling_saved']:.1f}% cooling saved  ·  "
            f"PUE {base_res.avg_pue:.3f} → {ai_res.avg_pue:.3f}  ·  "
            f"{ai_res.thermal_violations} thermal violations"
        )

# --- Two columns: Baseline vs AI -------------------------------------------
left, right = st.columns(2)
for col, name, hist, res in (
    (left, "Baseline (fixed 20°C)", sim["base_hist"], base_res),
    (right, f"AI · {ai_kind}", sim["ai_hist"], ai_res),
):
    with col:
        st.subheader(name)
        if hist["temps"] is not None:
            st.plotly_chart(
                temp_heatmap(hist["temps"], "Zone temperatures"),
                use_container_width=True,
                key=f"heat_{name}",
            )
        m1, m2, m3 = st.columns(3)
        cur_pue = hist["pue"][-1] if hist["pue"] else float("nan")
        cur_sp = hist["t_supply"][-1] if hist["t_supply"] else model.T_SUPPLY_INIT
        m1.metric("PUE", f"{cur_pue:.3f}")
        m2.metric("Setpoint", f"{cur_sp:.1f}°C")
        m3.metric("Cooling kWh", f"{res.cooling_kWh:.2f}")
        st.caption(
            f"thermal violations: {res.thermal_violations}  ·  "
            f"SLA violations: {res.sla_violations}"
        )

# --- Time-series comparison -------------------------------------------------
if sim["t"] > 1:
    st.markdown("### How the AI does it")
    g1, g2 = st.columns(2)
    with g1:
        st.plotly_chart(
            line_compare(
                sim["base_hist"]["t_supply"], sim["ai_hist"]["t_supply"],
                "Cooling setpoint over time", "T_supply (°C)",
            ),
            use_container_width=True,
        )
    with g2:
        st.plotly_chart(
            line_compare(
                sim["base_hist"]["cooling_kWh"], sim["ai_hist"]["cooling_kWh"],
                "Cumulative cooling energy", "kWh",
            ),
            use_container_width=True,
        )

# Keep animating while playing.
if sim["playing"] and not sim["done"]:
    st.rerun()
