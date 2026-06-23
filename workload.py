"""workload.py --- Contract A: the workload stream that drives everything.

Produces a deterministic (given ``seed``) list of :class:`WorkloadStep` describing
how busy each zone is and how many jobs arrive at each one-minute step.

Two sources, identical output format:
    synthetic : daily sinusoid + per-zone phase + noise + occasional spikes.
                100% offline, the default for training and the demo.
    azure     : parsed Azure Public VM trace bucketed into ``n_zones`` and
                normalized to [0, 1]. Falls back to a deterministic bursty
                generator (still Contract-A shaped) when the trace file is not
                present, so the call always works offline.
"""

from __future__ import annotations

import os
import warnings
from typing import Literal, NamedTuple

import numpy as np

# Jobs arriving per step at mean utilization 1.0. Busier -> more jobs.
ARRIVAL_SCALE = 10.0

# Where an optional cached Azure trace CSV is looked for (one column of CPU%
# readings, or a 2-D table). Kept local so the demo never needs the network.
_AZURE_CACHE = os.path.join(os.path.dirname(__file__), "data", "azure_vm_cpu.csv")


class WorkloadStep(NamedTuple):
    util: np.ndarray  # shape (n_zones,), dtype float32, each value in [0.0, 1.0]
    arrivals: float  # number of new jobs arriving this step, >= 0.0


def load_workload(
    source: Literal["synthetic", "azure"] = "synthetic",
    n_zones: int = 8,
    horizon: int = 1440,  # steps per episode (1440 min = 1 day at DT_HOURS = 1/60)
    seed: int = 0,
) -> list[WorkloadStep]:
    """Return a deterministic list of length ``horizon`` of :class:`WorkloadStep`.

    Parameters
    ----------
    source : {"synthetic", "azure"}
        Which generator to use. Both return the identical Contract-A format.
    n_zones : int
        Number of zones; the length of each ``util`` vector.
    horizon : int
        Number of one-minute steps to produce (1440 = one day).
    seed : int
        RNG seed; identical seed -> identical stream.
    """
    if source == "synthetic":
        return _synthetic(n_zones=n_zones, horizon=horizon, seed=seed)
    if source == "azure":
        return _azure(n_zones=n_zones, horizon=horizon, seed=seed)
    raise ValueError(f"unknown workload source: {source!r}")


def _synthetic(n_zones: int, horizon: int, seed: int) -> list[WorkloadStep]:
    """Daily sinusoid + per-zone phase + noise + occasional spikes."""
    rng = np.random.default_rng(seed)

    # Each zone peaks at a slightly different time of day.
    phase = rng.uniform(0.0, 2.0 * np.pi, size=n_zones)

    t = np.arange(horizon)
    # base_i(t) = 0.5 + 0.35 * sin(2*pi*(t/horizon) - phase_i)
    angle = 2.0 * np.pi * (t[:, None] / horizon) - phase[None, :]
    base = 0.5 + 0.35 * np.sin(angle)  # shape (horizon, n_zones)

    noise = rng.normal(0.0, 0.05, size=(horizon, n_zones))

    # Occasional positive spikes that hit a random subset of zones (hotspots).
    spike = np.zeros((horizon, n_zones))
    spike_steps = rng.random(horizon) < 0.02
    for ti in np.nonzero(spike_steps)[0]:
        hit = rng.random(n_zones) < 0.5
        spike[ti, hit] = rng.uniform(0.2, 0.5, size=int(hit.sum()))

    util = np.clip(base + noise + spike, 0.0, 1.0).astype(np.float32)
    return _to_steps(util)


def _azure(n_zones: int, horizon: int, seed: int) -> list[WorkloadStep]:
    """Parse a cached Azure VM trace; fall back to a bursty offline generator."""
    if os.path.exists(_AZURE_CACHE):
        try:
            return _parse_azure_csv(_AZURE_CACHE, n_zones, horizon)
        except Exception as exc:  # pragma: no cover - defensive parse guard
            warnings.warn(
                f"failed to parse Azure trace at {_AZURE_CACHE} ({exc}); "
                "falling back to a synthetic bursty trace."
            )
    else:
        warnings.warn(
            f"Azure trace not found at {_AZURE_CACHE}; using a deterministic "
            "bursty offline trace with identical Contract-A format."
        )

    # Offline fallback: heavier-tailed, burstier than the clean synthetic curve,
    # so it 'feels' like a real VM trace while staying 100% offline.
    rng = np.random.default_rng(seed + 991)
    t = np.arange(horizon)
    phase = rng.uniform(0.0, 2.0 * np.pi, size=n_zones)
    angle = 2.0 * np.pi * (t[:, None] / horizon) - phase[None, :]
    base = 0.45 + 0.30 * np.sin(angle)

    # Correlated bursts via a smoothed heavy-tailed driver per zone.
    raw = rng.gamma(shape=1.2, scale=0.12, size=(horizon, n_zones))
    kernel = np.ones(15) / 15.0
    burst = np.apply_along_axis(
        lambda c: np.convolve(c, kernel, mode="same"), axis=0, arr=raw
    )
    util = np.clip(base + burst - burst.mean(), 0.0, 1.0).astype(np.float32)
    return _to_steps(util)


def _parse_azure_csv(path: str, n_zones: int, horizon: int) -> list[WorkloadStep]:
    """Parse a CSV of CPU readings into ``n_zones`` columns over ``horizon`` rows.

    Accepts either a single column (reshaped/bucketed into zones) or a wide table
    (columns averaged down into ``n_zones`` buckets). Values are normalized so the
    busiest reading maps near 1.0.
    """
    data = np.loadtxt(path, delimiter=",", skiprows=0, ndmin=2)

    if data.shape[1] == 1:
        col = data[:, 0]
        # Tile / trim to exactly horizon * n_zones samples, then reshape.
        need = horizon * n_zones
        if col.size < need:
            col = np.tile(col, int(np.ceil(need / col.size)))
        col = col[:need]
        util = col.reshape(horizon, n_zones)
    else:
        # Average the wide table's columns down into n_zones contiguous buckets.
        cols = data.shape[1]
        buckets = np.array_split(np.arange(cols), n_zones)
        util = np.column_stack([data[:, b].mean(axis=1) for b in buckets])
        if util.shape[0] < horizon:
            reps = int(np.ceil(horizon / util.shape[0]))
            util = np.tile(util, (reps, 1))
        util = util[:horizon]

    # Normalize to [0, 1]; assume CPU% if values look like 0-100.
    hi = np.nanmax(util)
    if hi > 1.5:
        util = util / 100.0
    util = np.clip(util, 0.0, 1.0).astype(np.float32)
    return _to_steps(util)


def _to_steps(util: np.ndarray) -> list[WorkloadStep]:
    """Pack a (horizon, n_zones) utilization matrix into WorkloadStep records."""
    arrivals = ARRIVAL_SCALE * util.mean(axis=1)
    return [
        WorkloadStep(util=util[i].copy(), arrivals=float(arrivals[i]))
        for i in range(util.shape[0])
    ]


def _plot_daily_curve(steps: list[WorkloadStep], path: str = "workload_curve.png") -> str:
    """Save a believable daily load-curve plot and return the output path."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    util = np.array([s.util for s in steps])  # (horizon, n_zones)
    mean_util = util.mean(axis=1)
    hours = np.arange(util.shape[0]) / 60.0

    fig, ax = plt.subplots(figsize=(9, 5))
    for z in range(util.shape[1]):
        ax.plot(hours, util[:, z], alpha=0.25, linewidth=0.8)
    ax.plot(hours, mean_util, color="black", linewidth=2.5, label="mean utilization")
    ax.set_xlabel("Time (hours)")
    ax.set_ylabel("Utilization [0, 1]")
    ax.set_title("Synthetic daily workload curve (per-zone + mean)")
    ax.set_ylim(0, 1)
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


if __name__ == "__main__":
    # --- Test alone (AGENTS.md Section 9) ---
    HORIZON = 1440
    steps = load_workload("synthetic", n_zones=8, horizon=HORIZON, seed=0)
    assert len(steps) == HORIZON, "synthetic must return exactly `horizon` items"
    for s in steps:
        assert s.util.shape == (8,), "util must have shape (n_zones,)"
        assert s.util.dtype == np.float32, "util must be float32"
        assert np.all((s.util >= 0.0) & (s.util <= 1.0)), "util out of [0, 1]"
        assert s.arrivals >= 0.0, "arrivals must be non-negative"

    # Determinism: same seed -> identical stream.
    again = load_workload("synthetic", n_zones=8, horizon=HORIZON, seed=0)
    assert all(np.array_equal(a.util, b.util) for a, b in zip(steps, again))

    # Azure path returns the identical format (uses offline fallback if no file).
    azure = load_workload("azure", n_zones=8, horizon=HORIZON, seed=0)
    assert len(azure) == HORIZON and azure[0].util.shape == (8,)

    out = _plot_daily_curve(steps)
    mean_u = np.mean([s.util.mean() for s in steps])
    print(f"synthetic mean utilization = {mean_u:.3f}")
    print(f"daily load-curve plot saved to {out}")
    print("workload.py self-test passed.")
