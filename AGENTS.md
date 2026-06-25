# AGENTS.md — EcoTwin machine-readable spec

EcoTwin is an **environment-first datacenter advisor**. Flow:

```
DatacenterSpec ──generator──▶ DatacenterMock ──advisor──▶ OptimizationReport
 (user input)     (phase 1)    (as-built twin)  (+AI)      (env-first upgrades)
```

One request/response. No streaming, no RL, no training. Fully offline; the AI
model is optional.

## Layout
- `model.py` — repo-root physics (constants + pure functions). **Reused, do not duplicate.**
- `backend/` — FastAPI package (importing it puts repo root on `sys.path` so `import model` works).
  - `schemas.py` — Pydantic contracts (all JSON snake_case; the React types mirror these verbatim).
  - `generator.py` — `generate_mock(spec) -> DatacenterMock`. Owns `COOLING_PROFILES`, `CLIMATE_PROFILES`, carbon/price constants.
  - `advisor.py` — `generate_report(spec, mock) -> OptimizationReport`. Deterministic rules + optional AI summary.
  - `ai_client.py` — `ai_available()`, `ai_complete(system, user)`. The single AI integration point (Azure AI Foundry; stdlib `urllib` only).
  - `app.py` — `POST /api/generate`, `GET /health`.
- `web/` — React + Vite + Tailwind v4 UI.
  - `src/types.ts` mirrors `schemas.py`; `src/api.ts` calls the backend; components: `SpecForm`, `DatacenterMock`, `OptimizationReport`.
  - `web/.env` → `VITE_API_URL` (default `http://localhost:8000`).

## Contracts
- **Spec** (`DatacenterSpec`): name, num_clusters, racks_per_cluster, total_sqft, rack_density_kw, avg_utilization(0–1), cooling_type, climate, power_source, renewable_pct(0–100), setpoint_c, redundancy(N|N+1|2N), optional grid_carbon/price overrides.
- **Mock** (`DatacenterMock`): `facility` (loads MW/kW, pue, cop, density, labels, outside_air, free_cooling), `annual` (energy/cost/co2/water + intensity/price/renewable), `clusters[]` (per-cluster util/power/temps/state).
- **Report** (`OptimizationReport`): `ai_used`, `executive_summary`, `combined` (CombinedSavings), `recommendations[]` sorted by CO₂ avoided desc.
- **Recommendation**: id, title, category, priority(High|Medium|Low), summary, detail, annual_kwh_saved, annual_co2_saved_tonnes, annual_cost_saved_usd, water_saved_liters, capex_estimate_usd, payback_years|null, effort, ai_generated(bool; true for AI-proposed qualitative measures that carry no quantified savings).

## Rules of the road
- Keep the JSON shape stable; if you add a field, add it to both `schemas.py` and `types.ts`.
- Recommendation **numbers** are always computed deterministically (offline-safe) and never depend on the AI. When a model is configured the advisor runs a **hybrid** step (`_ai_enrich`, one round-trip): it rewrites each recommendation's narrative (title/summary/detail), appends up to 3 qualitative `ai_generated` measures that carry **no** quantified savings, and writes `executive_summary`. `combined` is computed *before* the AI extras so totals stay physical; the AI never alters a number.
- Environment first: rank/aggregate by CO₂, then energy, then water. Cap combined savings so overlapping measures stay physical (see `_combine`).
- All physical numbers trace back to `model.py` or the documented profiles in `generator.py` — no scattered magic constants.

## Run / verify
```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.app:app --port 8000 --reload   # MUST run from repo root
# smoke test:
python -c "from backend.schemas import DatacenterSpec; from backend.generator import generate_mock; from backend.advisor import generate_report; m=generate_mock(DatacenterSpec()); print(generate_report(DatacenterSpec(), m).combined)"
# frontend:
cd web; npm install; npm run dev      # :5173
cd web; npm run build                 # typecheck + production build
```

## AI integration (Azure AI Foundry)
Set `FOUNDRY_ENDPOINT` + `FOUNDRY_API_KEY` (+ `FOUNDRY_MODEL` for serverless) in `backend/ai_client.py` or via env. Endpoint = full chat-completions URL. Failures degrade silently to the deterministic report.
