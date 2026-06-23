"""baselines.py --- Contract C: dumb controllers to beat.

Both controllers map an observation to an action ``np.ndarray`` of shape (1,)
with values in [-1, 1], exactly like the trained AI. They are interchangeable
with the AI everywhere downstream (metrics, dashboard).

    FixedController     always holds T_SUPPLY_INIT (20 C). The main comparison.
    ReactiveController  a smarter strawman: cool hard when the hottest zone nears
                        T_MAX, otherwise relax the setpoint up to save energy.

Observation layout (see env.py / Contract B), length 2 * n_zones + 2:
    [ util(n_zones), temp_norm(n_zones), t_supply_norm, queue_norm ]
where temp_norm is mapped to [0, 1] over [T_SUPPLY_MIN, T_SUPPLY_MAX + R_TH*P_MAX].
"""

from __future__ import annotations

import numpy as np

import model

# Reconstruct the temperature normalization used by env.py so the reactive
# controller can reason in real degrees C without importing private env state.
_T_OBS_MIN = model.T_SUPPLY_MIN
_T_OBS_MAX = model.T_SUPPLY_MAX + model.R_TH * model.P_MAX_W


def _n_zones_from_obs(obs: np.ndarray) -> int:
    """Recover n_zones from a (2*n_zones + 2,) observation vector."""
    return (obs.shape[0] - 2) // 2


def _max_temp_c(obs: np.ndarray) -> float:
    """Decode the hottest zone temperature (degC) from an observation."""
    n = _n_zones_from_obs(obs)
    temp_norm = obs[n : 2 * n]
    temps_c = _T_OBS_MIN + temp_norm * (_T_OBS_MAX - _T_OBS_MIN)
    return float(np.max(temps_c))


class FixedController:
    """Always returns action [0.0] -> setpoint never moves from T_SUPPLY_INIT."""

    def __call__(self, obs: np.ndarray) -> np.ndarray:
        return np.array([0.0], dtype=np.float32)

    def reset(self) -> None:
        return None


class ReactiveController:
    """Threshold controller: cool when hot, relax when cool.

    Parameters
    ----------
    margin_c : float
        Start cooling when the hottest zone is within ``margin_c`` of T_MAX.
    relax_band_c : float
        Only relax (warm up) the setpoint when the hottest zone is at least
        ``relax_band_c`` below the cooling threshold, creating a dead-band that
        prevents setpoint chatter.
    """

    def __init__(self, margin_c: float = 3.0, relax_band_c: float = 2.0) -> None:
        self.margin_c = float(margin_c)
        self.relax_band_c = float(relax_band_c)

    def __call__(self, obs: np.ndarray) -> np.ndarray:
        max_temp = _max_temp_c(obs)
        cool_threshold = model.T_MAX - self.margin_c
        if max_temp >= cool_threshold:
            # Too hot: drive the setpoint down at full rate.
            return np.array([-1.0], dtype=np.float32)
        if max_temp <= cool_threshold - self.relax_band_c:
            # Comfortable margin: relax the setpoint up to save cooling energy.
            return np.array([1.0], dtype=np.float32)
        # Inside the dead-band: hold.
        return np.array([0.0], dtype=np.float32)

    def reset(self) -> None:
        return None


if __name__ == "__main__":
    # --- Test alone (AGENTS.md Section 9): run against a StubEnv honoring Contract B ---
    class StubEnv:
        """Minimal Contract-B-shaped env: constant obs, records setpoint moves."""

        def __init__(self, n_zones: int = model.N_ZONES, max_temp_c: float = 25.0):
            self.n_zones = n_zones
            self.t_supply = model.T_SUPPLY_INIT
            self._max_temp_c = max_temp_c

        def _obs(self) -> np.ndarray:
            n = self.n_zones
            util = np.full(n, 0.5, dtype=np.float32)
            temp_norm = np.full(
                n,
                (self._max_temp_c - _T_OBS_MIN) / (_T_OBS_MAX - _T_OBS_MIN),
                dtype=np.float32,
            )
            tail = np.array([0.2, 0.0], dtype=np.float32)
            return np.concatenate([util, temp_norm, tail])

        def apply(self, action: np.ndarray) -> None:
            self.t_supply = float(
                np.clip(
                    self.t_supply + float(action[0]) * model.MAX_DELTA_C,
                    model.T_SUPPLY_MIN,
                    model.T_SUPPLY_MAX,
                )
            )

    # Fixed controller never changes the setpoint.
    stub = StubEnv()
    fixed = FixedController()
    start = stub.t_supply
    for _ in range(20):
        stub.apply(fixed(stub._obs()))
    assert stub.t_supply == start, "FixedController must never move the setpoint"

    # Reactive controller cools when hot.
    hot = StubEnv(max_temp_c=model.T_MAX - 1.0)  # within margin -> should cool
    reactive = ReactiveController()
    a_hot = reactive(hot._obs())
    assert a_hot[0] < 0, "ReactiveController should cool (negative action) when hot"

    # Reactive controller relaxes when cool.
    cool = StubEnv(max_temp_c=20.0)  # well below threshold -> should relax up
    a_cool = reactive(cool._obs())
    assert a_cool[0] > 0, "ReactiveController should relax (positive action) when cool"

    print("FixedController: setpoint held at", start, "C over 20 steps.")
    print("ReactiveController hot-action =", float(a_hot[0]),
          "cool-action =", float(a_cool[0]))
    print("baselines.py self-test passed.")
