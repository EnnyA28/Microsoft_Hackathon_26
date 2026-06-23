"""bridge/app.py --- FastAPI bridge serving the real DC-Twin to the ThermaMind UI.

Runs ONE shared lockstep simulation (baseline vs AI) and:
  * streams ThermaMind-shaped telemetry to every connected client over /ws,
  * answers the offline assistant's ``ask_ai`` / ``ask_question`` messages,
  * exposes REST controls (/api/optimize, /api/simulate-load-spike, /telemetry).

Run it:
    python -m uvicorn bridge.app:app --port 8000
The React frontend (web/) connects to ws://localhost:8000/ws (see web/.env).
"""

from __future__ import annotations

import asyncio
import os
import sys

# Make the repo-root modules (model, env, metrics, ...) importable regardless of CWD.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from bridge import assistant  # noqa: E402
from bridge.sim_runtime import SimRuntime  # noqa: E402

TICK_SECONDS = float(os.environ.get("DCTWIN_TICK_SECONDS", "1.0"))
STEPS_PER_TICK = int(os.environ.get("DCTWIN_STEPS_PER_TICK", "3"))
AI_PREFER = os.environ.get("DCTWIN_AI", "auto")  # "auto" | "ppo" | "heuristic"
SOURCE = os.environ.get("DCTWIN_SOURCE", "synthetic")  # "synthetic" | "azure"
# Outside-air economizer makes COP/PUE track time-of-day; on by default for realism.
OUTSIDE_AIR = os.environ.get("DCTWIN_OUTSIDE_AIR", "1").lower() not in ("0", "false", "no", "")


class Hub:
    """Shared simulation + the set of connected websocket clients."""

    def __init__(self) -> None:
        self.runtime = SimRuntime(
            steps_per_tick=STEPS_PER_TICK,
            ai_prefer=AI_PREFER,
            source=SOURCE,
            outside_air=OUTSIDE_AIR,
        )
        self.clients: set[WebSocket] = set()
        self.latest: dict | None = self.runtime.snapshot()
        self.muted = False
        self._lock = asyncio.Lock()

    async def broadcaster(self) -> None:
        """Advance the sim and push telemetry to all clients forever."""
        while True:
            await asyncio.sleep(TICK_SECONDS)
            async with self._lock:
                self.latest = self.runtime.tick()
            message = {"type": "telemetry", "payload": self.latest}
            dead = []
            for ws in list(self.clients):
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.clients.discard(ws)


hub: Hub | None = None


async def _lifespan(app: FastAPI):
    global hub
    hub = Hub()
    task = asyncio.create_task(hub.broadcaster())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="DC-Twin Bridge", version="1.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "ai": hub.runtime.ai_kind, "steps": hub.runtime.steps}


@app.get("/telemetry")
async def telemetry() -> dict:
    return hub.latest or hub.runtime.snapshot()


@app.post("/api/optimize")
async def optimize() -> dict:
    """Return the AI's live recommendation + the real baseline-vs-AI comparison."""
    s = hub.runtime.status_summary()
    c = hub.runtime.comparison()
    return {
        "action": (f"Hold setpoint at {s['t_supply']:.1f}\u00b0C "
                   f"({hub.runtime.ai_kind} policy)"),
        "setpoint_c": s["t_supply"],
        "pct_cooling_saved": round(c["pct_cooling_saved"], 2),
        "delta_pue": round(c["delta_pue"], 3),
        "thermal_violations": s["thermal_violations"],
        "recommend_cluster": s["coolest"]["cluster"],
        "avoid_cluster": s["hottest"]["cluster"],
    }


@app.post("/api/simulate-load-spike")
async def simulate_load_spike(payload: dict | None = None) -> dict:
    """Inject a workload spike into both twins (e.g. {"magnitude":1.6,"duration":60})."""
    payload = payload or {}
    async with hub._lock:
        return hub.runtime.inject_spike(
            magnitude=float(payload.get("magnitude", 1.6)),
            duration=int(payload.get("duration", 60)),
            zones=payload.get("zones"),
        )


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    hub.clients.add(ws)
    # Send the latest snapshot immediately so the UI paints without waiting a tick.
    try:
        await ws.send_json({"type": "telemetry", "payload": hub.latest})
    except Exception:
        pass
    try:
        while True:
            msg = await ws.receive_json()
            await _handle_client_message(ws, msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.clients.discard(ws)


async def _handle_client_message(ws: WebSocket, msg: dict) -> None:
    """Handle assistant + mute messages from a single client (offline, no audio)."""
    mtype = msg.get("type")
    if mtype == "ask_ai":
        text = assistant.analyze(hub.runtime.status_summary())
        await ws.send_json({"type": "ai_response", "text": text})
    elif mtype == "ask_question":
        answer = assistant.answer(msg.get("question", ""), hub.runtime.status_summary())
        await ws.send_json({"type": "ai_answer", "answer": answer})
    elif mtype == "mute":
        hub.muted = True
        await ws.send_json({"type": "mute-state", "muted": True})
    elif mtype == "unmute":
        hub.muted = False
        await ws.send_json({"type": "mute-state", "muted": False})
    elif mtype == "get-mute-state":
        await ws.send_json({"type": "mute-state", "muted": hub.muted})
