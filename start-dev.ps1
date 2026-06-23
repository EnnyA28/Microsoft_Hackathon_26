<#
  start-dev.ps1 — One-command launcher for the integrated DC-Twin demo.

  Brings up:
    1. Python bridge  (FastAPI)  -> ws://localhost:8000/ws   REAL RL digital twin
    2. React frontend (Vite)     -> http://localhost:5173     ThermaMind dashboard
    3. (optional) Node mock      -> ws://localhost:8080       original mock simulator

  Usage:
    .\start-dev.ps1            # bridge + frontend (the real twin)
    .\start-dev.ps1 -Mock      # also start the Node mock backend on 8080
    .\start-dev.ps1 -NoBridge  # frontend only (point web/.env at 8080 yourself)

  Each service opens in its own PowerShell window. Close the windows (or Ctrl+C
  in each) to stop. Everything runs fully offline.
#>
[CmdletBinding()]
param(
    [switch]$Mock,
    [switch]$NoBridge
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Write-Host "DC-Twin x ThermaMind launcher" -ForegroundColor Cyan
Write-Host "Repo: $root`n"

# --- 1. Python bridge (real twin) ---
if (-not $NoBridge) {
    $venv = Join-Path $root ".venv\Scripts\Activate.ps1"
    if (-not (Test-Path $venv)) {
        Write-Warning "venv not found at $venv — create it with: python -m venv .venv; then pip install -r requirements.txt"
    }
    Write-Host "-> Starting Python bridge on http://localhost:8000 (ws://localhost:8000/ws)" -ForegroundColor Green
    $bridgeCmd = "& '$venv'; python -m uvicorn bridge.app:app --port 8000"
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", $bridgeCmd -WorkingDirectory $root
}

# --- 2. Optional Node mock backend ---
if ($Mock) {
    $mockDir = Join-Path $root "mock-backend"
    Write-Host "-> Starting Node mock backend on ws://localhost:8080" -ForegroundColor Green
    $mockCmd = "if (-not (Test-Path node_modules)) { npm install }; npm start"
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", $mockCmd -WorkingDirectory $mockDir
}

# --- 3. React frontend ---
$webDir = Join-Path $root "web"
Write-Host "-> Starting React frontend on http://localhost:5173" -ForegroundColor Green
$webCmd = "if (-not (Test-Path node_modules)) { npm install }; npm run dev"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", $webCmd -WorkingDirectory $webDir

Write-Host "`nAll services launching in separate windows." -ForegroundColor Cyan
Write-Host "  Dashboard : http://localhost:5173"
Write-Host "  Bridge    : ws://localhost:8000/ws  (real DC-Twin)"
if ($Mock) { Write-Host "  Node mock : ws://localhost:8080  (set web/.env VITE_WS_URL to use it)" }
Write-Host "`nThe dashboard reads web/.env (VITE_WS_URL). Default = the real bridge on 8000."
