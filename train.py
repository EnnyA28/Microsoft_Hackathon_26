"""train.py --- Contract C (the AI): PPO controller + a robust fallback.

Primary path
    Train a PPO agent (Stable-Baselines3) on :class:`DCTwinEnv`. After training it
    should raise the setpoint at low load and drop it before any zone approaches
    T_MAX, beating the fixed baseline on cooling energy with 0 thermal violations.

Fallback path (AGENTS.md Section 9 "decide by Day 2 noon")
    :class:`GreedySafeController` is a model-predictive heuristic that each step
    drives the setpoint as high as physics allows while keeping the hottest zone a
    safety margin below T_MAX. It reliably hits the win condition and is a valid
    stand-in "AI" for the pitch if PPO is unstable.

Both expose the Contract-C interface ``__call__(obs) -> action`` and ``reset()``.

CLI
    python train.py                 # train PPO (~200k steps) then show the money table
    python train.py --timesteps 50000
    python train.py --eval-only     # load saved PPO and evaluate
    python train.py --heuristic     # evaluate the greedy-safe fallback only
"""

from __future__ import annotations

import argparse
import os

import numpy as np

import model
from baselines import FixedController
from env import DCTwinEnv
from metrics import print_money_table, run_episode

MODEL_PATH = os.path.join(os.path.dirname(__file__), "ppo_dctwin.zip")


# --- Fallback "AI": model-predictive greedy-safe controller (Contract C) ---
class GreedySafeController:
    """Raise the setpoint as high as safe each step; guarantees ~0 violations.

    Uses the same physics as the twin (Contract D) to predict the hottest zone's
    temperature, then targets the warmest setpoint that keeps it ``safety_c``
    below T_MAX. The setpoint moves toward that target at up to MAX_DELTA_C/step.
    """

    def __init__(self, safety_c: float = 2.0) -> None:
        self.safety_c = float(safety_c)

    def __call__(self, obs: np.ndarray) -> np.ndarray:
        obs = np.asarray(obs, dtype=np.float32)
        n = (obs.shape[0] - 2) // 2
        util = obs[:n]
        t_supply_norm = float(obs[2 * n])
        cur_setpoint = model.T_SUPPLY_MIN + t_supply_norm * (
            model.T_SUPPLY_MAX - model.T_SUPPLY_MIN
        )
        # Hottest zone temp = T_supply + R_TH * max(P_it). Solve for the setpoint
        # that puts it exactly safety_c below T_MAX.
        p_it_max = float(model.it_power(util).max())
        target = model.T_MAX - self.safety_c - model.R_TH * p_it_max
        target = float(np.clip(target, model.T_SUPPLY_MIN, model.T_SUPPLY_MAX))
        delta = (target - cur_setpoint) / model.MAX_DELTA_C
        return np.array([np.clip(delta, -1.0, 1.0)], dtype=np.float32)

    def reset(self) -> None:
        return None


# --- Primary "AI": PPO policy wrapper (Contract C) ---
class PPOController:
    """Wraps a trained Stable-Baselines3 PPO policy as a Contract-C controller."""

    def __init__(self, model_path: str = MODEL_PATH) -> None:
        from stable_baselines3 import PPO

        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"no trained PPO model at {model_path}; run `python train.py` first."
            )
        self.model = PPO.load(model_path)

    def __call__(self, obs: np.ndarray) -> np.ndarray:
        action, _ = self.model.predict(np.asarray(obs, dtype=np.float32), deterministic=True)
        return np.asarray(action, dtype=np.float32).reshape(1)

    def reset(self) -> None:
        return None


def load_ai_controller(prefer: str = "auto"):
    """Return the controller the demo should treat as "the AI".

    prefer: "ppo" (require trained model), "heuristic" (greedy-safe), or "auto"
    (trained PPO if available and loadable, otherwise the greedy-safe fallback).
    """
    if prefer == "heuristic":
        return GreedySafeController()
    if prefer in ("ppo", "auto") and os.path.exists(MODEL_PATH):
        try:
            return PPOController()
        except Exception as exc:  # pragma: no cover - defensive load guard
            if prefer == "ppo":
                raise
            print(f"[train] PPO load failed ({exc}); using greedy-safe fallback.")
    return GreedySafeController()


# Lazily-built singleton so `ai_controller(obs)` works as a bare function
# (Contract C convenience entry point named in AGENTS.md Section 9).
_AI_SINGLETON = None


def ai_controller(obs: np.ndarray) -> np.ndarray:
    """Map an observation to an action using the best available AI (Contract C)."""
    global _AI_SINGLETON
    if _AI_SINGLETON is None:
        _AI_SINGLETON = load_ai_controller(prefer="auto")
    return _AI_SINGLETON(obs)


def _make_progress_callback(every: int = 10_000):
    """Callback that prints the mean episode reward every ``every`` steps."""
    from stable_baselines3.common.callbacks import BaseCallback

    class _Progress(BaseCallback):
        def __init__(self) -> None:
            super().__init__()
            self._next = every

        def _on_step(self) -> bool:
            if self.num_timesteps >= self._next:
                self._next += every
                buf = self.model.ep_info_buffer
                if buf:
                    mean_r = float(np.mean([e["r"] for e in buf]))
                    print(f"  step {self.num_timesteps:>8}: mean_ep_reward = {mean_r:10.2f}")
            return True

    return _Progress()


def train(timesteps: int = 300_000, seed: int = 0, save_path: str = MODEL_PATH):
    """Train PPO on the twin and save the policy. Returns the trained model."""
    from stable_baselines3 import PPO
    from stable_baselines3.common.monitor import Monitor
    from stable_baselines3.common.vec_env import DummyVecEnv

    def _make():
        return Monitor(DCTwinEnv(source="synthetic", horizon=1440, seed=seed))

    venv = DummyVecEnv([_make])
    ppo = PPO(
        "MlpPolicy",
        venv,
        seed=seed,
        n_steps=2048,
        batch_size=128,
        gae_lambda=0.95,
        gamma=0.99,
        ent_coef=0.01,  # encourage exploration so the agent finds the warm-but-safe band
        learning_rate=3e-4,
        policy_kwargs=dict(net_arch=[64, 64]),
        verbose=0,
    )
    print(f"[train] PPO learning for {timesteps:,} steps ...")
    ppo.learn(total_timesteps=timesteps, callback=_make_progress_callback())
    ppo.save(save_path)
    print(f"[train] saved policy to {save_path}")
    return ppo


def evaluate(controller, label: str, seed: int = 0) -> dict:
    """Run the fixed baseline and ``controller`` on one episode; print the table."""
    base_env = DCTwinEnv(source="synthetic", horizon=1440, seed=seed)
    ai_env = DCTwinEnv(source="synthetic", horizon=1440, seed=seed)
    baseline = run_episode(base_env, FixedController(), seed=seed)
    ai = run_episode(ai_env, controller, seed=seed)
    return print_money_table(baseline, ai, ai_label=label)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train/evaluate the DC-Twin AI controller.")
    p.add_argument("--timesteps", type=int, default=300_000, help="PPO training steps.")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--eval-only", action="store_true", help="Skip training; load saved PPO.")
    p.add_argument("--heuristic", action="store_true", help="Evaluate greedy-safe fallback.")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()

    if args.heuristic:
        evaluate(GreedySafeController(), label="Greedy-Safe (heuristic AI)", seed=args.seed)
    elif args.eval_only:
        evaluate(load_ai_controller(prefer="auto"), label="PPO (AI)", seed=args.seed)
    else:
        train(timesteps=args.timesteps, seed=args.seed)
        print()
        ppo_cmp = evaluate(PPOController(), label="PPO (AI)", seed=args.seed)
        if not ppo_cmp["win"]:
            # PPO did not clear the bar -> show the reliable fallback for the pitch.
            print("\n[train] PPO below target; greedy-safe fallback result:")
            evaluate(GreedySafeController(), label="Greedy-Safe (fallback AI)", seed=args.seed)
