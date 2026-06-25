"""backend/app.py --- EcoTwin FastAPI service.

One endpoint does the whole job: take the datacenter spec, generate the mock
(phase 1), and return the environment-first optimization report.

Run it from the repo root:
    python -m uvicorn backend.app:app --port 8000 --reload
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import ai_client
from backend.advisor import generate_report
from backend.generator import generate_mock
from backend.schemas import DatacenterSpec, GenerateResponse

app = FastAPI(title="EcoTwin", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """Liveness + whether an Azure AI Foundry model is wired in."""
    return {"ok": True, "ai_configured": ai_client.ai_available()}


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(spec: DatacenterSpec) -> GenerateResponse:
    """Spec -> generated datacenter mock + environment-first upgrade report."""
    mock = generate_mock(spec)
    report = generate_report(spec, mock)
    return GenerateResponse(spec=spec, mock=mock, report=report)
