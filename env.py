"""env.py --- Contract B: the DC-Twin Gymnasium environment.

Wires the workload stream (Contract A) and the physics model (Contract D) into a
standard Gymnasium env. A controller observes the datacenter state, nudges the
cooling setpoint, and is rewarded for using less energy while never overheating
and keeping the job queue (SLA) healthy.

Observation (shape = 2 * N_ZONES + 2)
    [ u_0..u_{n-1},      utilization per zone, [0, 1]
      T_0..T_{n-1},      zone temperature, normalized to [0, 1] over
                         [T_SUPPLY_MIN, T_SUPPLY_MAX + R_TH * P_MAX_W]
      T_supply_norm,     setpoint mapped to [0, 1] over [T_SUPPLY_MIN, T_SUPPLY_MAX]
      queue_norm ]       SLA queue length normalized to [0, 1]

Action (shape = 1)
    delta in [-1, 1]  ->  T_supply += delta * MAX_DELTA_C, clipped to [MIN, MAX]

Reward (AGENTS.md Section 10)
    reward = -W_E * E_step_norm
             - LAMBDA_T * sum_i( max(0, T_i - T_MAX)^2 )
             - LAMBDA_S * sla_violations_this_step
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium import spaces

import model
from workload import WorkloadStep, load_workload

# --- Reward weights (tuned in train.py) ---
# Safety must dominate: any thermal violation should swamp the energy term so the
# agent never trades safety for energy.
W_E = 1.0  # energy weight
LAMBDA_T = 100.0  # thermal-violation weight (>> W_E by design)
LAMBDA_S = 1.0  # SLA-violation weight

# --- SLA queue model ---
SERVICE_RATE = 9.0  # jobs the cluster clears per step at full health
QUEUE_SLA_MAX = 20.0  # queue length above which a step counts as an SLA violation
QUEUE_NORM_DIV = 40.0  # divisor mapping queue length -> [0, 1] observation
T_THROTTLE = 30.0  # zone temp (degC) above which throughput throttles
THROTTLE_FLOOR = 0.5  # service multiplier when a zone is at T_MAX (linear to 1.0)

# Temperature normalization range for the observation.
_T_OBS_MIN = model.T_SUPPLY_MIN
_T_OBS_MAX = model.T_SUPPLY_MAX + model.R_TH * model.P_MAX_W  # warmest plausible zone

# Reference COOLING energy (kWh) used to normalize the energy reward to ~O(1).
# The agent only controls cooling energy (IT power is workload-driven and fixed),
# so rewarding on cooling energy -- not total -- gives a strong, controllable
# gradient (~25% swing across the setpoint band vs ~5% for total energy). This
# aligns the reward with the headline win metric: cooling energy saved.
_p_it_ref, _p_cool_ref, _ = model.totals(
    model.it_power(np.ones(model.N_ZONES)), model.T_SUPPLY_INIT
)
_E_COOL_REF_KWH = model.step_energy_kwh(_p_cool_ref)


class DCTwinEnv(gym.Env):
    """Datacenter cooling digital twin (Contract B)."""

    metadata = {"render_modes": []}

    def __init__(
        self,
        source: str = "synthetic",
        n_zones: int = model.N_ZONES,
        horizon: int = 1440,
        seed: int = 0,
        reward_weights: dict | None = None,
        outside_air: bool = False,
    ) -> None:
        super().__init__()
        self.source = source
        self.n_zones = int(n_zones)
        self.horizon = int(horizon)
        self._seed = int(seed)
        # When True, the cooling COP (and thus PUE/energy) varies with a diurnal
        # outside-air temperature -- a real economized facility. Off by default so
        # the trained PPO, metrics, and saved results are bit-for-bit unchanged.
        self.outside_air = bool(outside_air)

        rw = reward_weights or {}
        self.w_e = float(rw.get("w_e", W_E))
        self.lambda_t = float(rw.get("lambda_t", LAMBDA_T))
        self.lambda_s = float(rw.get("lambda_s", LAMBDA_S))

        # action: single setpoint delta in [-1, 1]
        self.action_space = spaces.Box(-1.0, 1.0, shape=(1,), dtype=np.float32)

        # observation: util (n) + temp_norm (n) + t_supply_norm (1) + queue_norm (1)
        obs_dim = 2 * self.n_zones + 2
        low = np.zeros(obs_dim, dtype=np.float32)
        high = np.ones(obs_dim, dtype=np.float32)
        # Allow zone-temp normalization to slightly exceed 1.0 (hot zones) so the
        # agent can still 'see' an overheating state instead of it being clipped flat.
        high[self.n_zones : 2 * self.n_zones] = 2.0
        self.observation_space = spaces.Box(low, high, dtype=np.float32)

        # Episode state (populated in reset()).
        self._workload: list[WorkloadStep] = []
        self.t = 0
        self.t_supply = model.T_SUPPLY_INIT
        self.queue = 0.0
        self.cum_energy_kwh = 0.0
        self.cum_thermal_violations = 0
        self.cum_sla_violations = 0
        self._last_util = np.zeros(self.n_zones, dtype=np.float32)
        self._last_temps = np.full(self.n_zones, model.T_SUPPLY_INIT, dtype=np.float32)

    # --- Gymnasium API ---
    def reset(
        self, *, seed: int | None = None, options: dict | None = None
    ) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        use_seed = self._seed if seed is None else int(seed)

        self._workload = load_workload(
            source=self.source,
            n_zones=self.n_zones,
            horizon=self.horizon,
            seed=use_seed,
        )

        self.t = 0
        self.t_supply = model.T_SUPPLY_INIT
        self.queue = 0.0
        self.cum_energy_kwh = 0.0
        self.cum_thermal_violations = 0
        self.cum_sla_violations = 0

        step0 = self._workload[0]
        self._last_util = step0.util.astype(np.float32)
        self._last_temps = model.zone_temps(
            self.t_supply, model.it_power(step0.util)
        ).astype(np.float32)

        return self._build_obs(self._last_util, self._last_temps), self._info_reset()

    def step(
        self, action: np.ndarray
    ) -> tuple[np.ndarray, float, bool, bool, dict]:
        # 1) Apply setpoint delta and clip to the allowed band.
        delta = float(np.asarray(action, dtype=np.float32).reshape(-1)[0])
        delta = float(np.clip(delta, -1.0, 1.0))
        self.t_supply = float(
            np.clip(
                self.t_supply + delta * model.MAX_DELTA_C,
                model.T_SUPPLY_MIN,
                model.T_SUPPLY_MAX,
            )
        )

        # 2) Pull this step's workload.
        ws = self._workload[self.t]
        util = ws.util.astype(np.float32)

        # 3) Physics: power, temperature, cooling, energy, PUE. With the outside-air
        #    economizer enabled the COP (hence PUE/energy) tracks the time-of-day
        #    outside temperature; zone temps depend only on the setpoint + load.
        t_outside = (
            model.outside_air_temp(self.t, self.horizon) if self.outside_air else None
        )
        p_it = model.it_power(util)
        temps = model.zone_temps(self.t_supply, p_it)
        p_it_total, p_cool, pue = model.totals(p_it, self.t_supply, t_outside)
        p_total = p_it_total + p_cool
        step_energy = model.step_energy_kwh(p_total)
        self.cum_energy_kwh += step_energy

        # 4) SLA queue update with thermal throttling.
        max_temp = float(temps.max())
        throttle = self._throttle_factor(max_temp)
        served = SERVICE_RATE * throttle
        self.queue = max(0.0, self.queue + ws.arrivals - served)
        sla_violation = 1 if self.queue > QUEUE_SLA_MAX else 0
        self.cum_sla_violations += sla_violation

        # 5) Thermal violations: count zones above T_MAX this step.
        over = int(np.count_nonzero(temps > model.T_MAX))
        self.cum_thermal_violations += over

        # 6) Reward (Section 10). Energy term uses COOLING energy -- the part the
        #    agent actually controls -- so raising the setpoint is clearly rewarded.
        step_cooling_kwh = model.step_energy_kwh(p_cool)
        e_norm = step_cooling_kwh / _E_COOL_REF_KWH
        overshoot = np.maximum(0.0, temps - model.T_MAX)
        thermal_pen = float(np.sum(overshoot**2))
        reward = (
            -self.w_e * e_norm
            - self.lambda_t * thermal_pen
            - self.lambda_s * sla_violation
        )

        # 7) Full info dict (Contract B required keys).
        info = {
            "step_energy_kWh": float(step_energy),
            "energy_kWh": float(self.cum_energy_kwh),
            "pue": float(pue),
            "p_it_total_w": float(p_it_total),
            "p_cool_w": float(p_cool),
            "temps": temps.astype(np.float32),
            "max_temp": max_temp,
            "t_supply": float(self.t_supply),
            "cop": float(model.cop(self.t_supply, t_outside)),
            "t_outside": float(
                t_outside if t_outside is not None else model.T_OUTSIDE_REF_C
            ),
            "thermal_violations": int(self.cum_thermal_violations),
            "sla_violations": int(self.cum_sla_violations),
            "queue_len": float(self.queue),
        }

        # 8) Advance index; episode truncates when the workload is exhausted.
        self._last_util = util
        self._last_temps = temps.astype(np.float32)
        self.t += 1
        truncated = self.t >= self.horizon
        terminated = False

        obs = self._build_obs(util, temps)
        return obs, float(reward), terminated, truncated, info

    # --- Helpers ---
    def _throttle_factor(self, max_temp: float) -> float:
        """Service-capacity multiplier in [THROTTLE_FLOOR, 1] as zones heat up."""
        if max_temp <= T_THROTTLE:
            return 1.0
        span = model.T_MAX - T_THROTTLE
        frac = min(1.0, (max_temp - T_THROTTLE) / span) if span > 0 else 1.0
        return float(1.0 - (1.0 - THROTTLE_FLOOR) * frac)

    def _build_obs(self, util: np.ndarray, temps: np.ndarray) -> np.ndarray:
        temp_norm = (temps - _T_OBS_MIN) / (_T_OBS_MAX - _T_OBS_MIN)
        t_supply_norm = (self.t_supply - model.T_SUPPLY_MIN) / (
            model.T_SUPPLY_MAX - model.T_SUPPLY_MIN
        )
        queue_norm = min(1.0, self.queue / QUEUE_NORM_DIV)
        obs = np.concatenate(
            [
                util.astype(np.float32),
                temp_norm.astype(np.float32),
                np.array([t_supply_norm, queue_norm], dtype=np.float32),
            ]
        )
        return np.clip(obs, self.observation_space.low, self.observation_space.high)

    def _info_reset(self) -> dict:
        t_outside = (
            model.outside_air_temp(0, self.horizon) if self.outside_air else None
        )
        p_it = model.it_power(self._last_util)
        p_it_total, p_cool, pue = model.totals(p_it, self.t_supply, t_outside)
        return {
            "step_energy_kWh": 0.0,
            "energy_kWh": 0.0,
            "pue": float(pue),
            "p_it_total_w": float(p_it_total),
            "p_cool_w": float(p_cool),
            "temps": self._last_temps.astype(np.float32),
            "max_temp": float(self._last_temps.max()),
            "t_supply": float(self.t_supply),
            "cop": float(model.cop(self.t_supply, t_outside)),
            "t_outside": float(
                t_outside if t_outside is not None else model.T_OUTSIDE_REF_C
            ),
            "thermal_violations": 0,
            "sla_violations": 0,
            "queue_len": float(self.queue),
        }


if __name__ == "__main__":
    # --- Test alone (AGENTS.md Section 9) ---
    env = DCTwinEnv(source="synthetic", horizon=1440, seed=0)
    obs, info = env.reset()
    assert env.observation_space.contains(obs), "reset obs outside observation_space"
    assert obs.shape == (2 * model.N_ZONES + 2,), "wrong observation shape"

    print(f"{'step':>4} {'t_supply':>8} {'PUE':>6} {'maxT(C)':>8} {'E(kWh)':>8} {'reward':>9}")
    for i in range(5):
        obs, reward, terminated, truncated, info = env.step(np.array([0.0], np.float32))
        assert env.observation_space.contains(obs), "step obs outside observation_space"
        assert 1.0 < info["pue"] < 1.6, f"PUE out of band: {info['pue']}"
        required = {
            "step_energy_kWh", "energy_kWh", "pue", "p_it_total_w", "p_cool_w",
            "temps", "max_temp", "t_supply", "thermal_violations",
            "sla_violations", "queue_len",
        }
        assert required <= set(info), f"missing info keys: {required - set(info)}"
        print(
            f"{i:>4} {info['t_supply']:8.2f} {info['pue']:6.3f} "
            f"{info['max_temp']:8.2f} {info['energy_kWh']:8.4f} {reward:9.3f}"
        )

    # Busier load -> hotter zones -> more cooling power (sensible monotonicity).
    idle_p_it, idle_p_cool, _ = model.totals(
        model.it_power(np.full(model.N_ZONES, 0.1)), model.T_SUPPLY_INIT
    )
    busy_p_it, busy_p_cool, _ = model.totals(
        model.it_power(np.full(model.N_ZONES, 0.9)), model.T_SUPPLY_INIT
    )
    assert busy_p_cool > idle_p_cool, "busier load should need more cooling power"
    print("\nenv.py self-test passed.")
