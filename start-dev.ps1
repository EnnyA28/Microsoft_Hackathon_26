<#
  start-dev.ps1 — One-command launcher for EcoTwin.

  Brings up:
    1. FastAPI backend (Python)  -> http://localhost:8000   spec -> mock + report
    2. React frontend (Vite)     -> http://localhost:5173   the EcoTwin UI

  Usage:
    .\start-dev.ps1            # backend + frontend
    .\start-dev.ps1 -NoBackend # frontend only

  Each service opens in its own PowerShell window. Close the windows (or Ctrl+C
  in each) to stop. Everything runs fully offline (the AI hook is optional).
#>
[CmdletBinding()]
param(
    [switch]$NoBackend
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Write-Host "EcoTwin launcher" -ForegroundColor Green
Write-Host "Repo: $root`n"

# --- 1. FastAPI backend ---
if (-not $NoBackend) {
    $venv = Join-Path $root ".venv\Scripts\Activate.ps1"
    if (-not (Test-Path $venv)) {
        Write-Warning "venv not found at $venv — create it with: python -m venv .venv; then pip install -r requirements.txt"
    }
    Write-Host "-> Starting FastAPI backend on http://localhost:8000" -ForegroundColor Green
    $backendCmd = "& '$venv'; python -m uvicorn backend.app:app --port 8000 --reload"
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", $backendCmd -WorkingDirectory $root
}

# --- 2. React frontend ---
$webDir = Join-Path $root "web"
Write-Host "-> Starting React frontend on http://localhost:5173" -ForegroundColor Green
$webCmd = "if (-not (Test-Path node_modules)) { npm install }; npm run dev"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", $webCmd -WorkingDirectory $webDir

Write-Host "`nAll services launching in separate windows." -ForegroundColor Cyan
Write-Host "  UI       : http://localhost:5173"
Write-Host "  Backend  : http://localhost:8000  (POST /api/generate, GET /health)"
Write-Host "`nThe UI reads web/.env (VITE_API_URL). Default = the backend on 8000."
