<p align="center">
  <strong>❄️ ArcticFlow</strong><br/>
  <em>AI-Powered Datacenter Cooling Optimization</em>
</p>

---

## What is ArcticFlow?

ArcticFlow is an AI-powered digital twin that simulates a datacenter's cooling system and uses reinforcement learning to **reduce energy consumption by 10–25%** — with zero thermal violations.

Traditional datacenters cool everything to a fixed 20°C setpoint, like leaving the AC on full blast in an empty building. ArcticFlow's AI controller **dynamically adjusts cooling based on real-time workload** — raising the setpoint when GPUs are idle (saving energy) and pre-cooling before demand spikes (preventing overheating).

> **Pitch:** *"ArcticFlow cut cooling energy by 15–25% compared to fixed-setpoint cooling, with 0 thermal violations — saving an estimated $87K and 244 tonnes of CO₂ per year on a 1 MW datacenter."*

---

## 🎯 The Problem

| | Traditional Cooling | ArcticFlow AI |
|---|---|---|
| **Strategy** | Fixed 20°C setpoint, always | Dynamic setpoint (18–27°C) based on load |
| **When GPUs are idle** | Still cooling at full power 💸 | Raises setpoint → 30% less cooling power |
| **When load spikes** | Reacts after temp rises | Pre-cools based on learned patterns |
| **Energy waste** | 15–30% over-cooling | Near-optimal COP efficiency |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React Dashboard (web/)          Azure Static Web App   │
│  • Real-time telemetry charts    • 3D datacenter view   │
│  • GPU cluster fleet status      • AI assistant chat    │
│  • Day/Night theme toggle        • Workload source toggle│
└────────────────────┬────────────────────────────────────┘
                     │ WebSocket (wss://)
┌────────────────────▼────────────────────────────────────┐
│  Node.js Backend (mock-backend/)   Azure App Service    │
│  • Simulates 6 clusters × 6 racks × 8 nodes (288 GPUs) │
│  • AI-optimized cooling vs traditional baseline         │
│  • Real Azure VM trace replay or synthetic workload     │
│  • Azure OpenAI–powered AI assistant                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Python RL Pipeline (model.py → train.py)               │
│  • Physics engine (COP, PUE, thermal model)             │
│  • Gymnasium environment (DCTwinEnv)                    │
│  • PPO training (Stable-Baselines3)                     │
│  • Baseline comparisons & metrics                       │
└─────────────────────────────────────────────────────────┘
```

---

## 🔬 How It Works

### The Physics (model.py)

The digital twin models real thermodynamic relationships:

- **IT Power:** `P_it = P_idle + (P_max - P_idle) × utilization` per node
- **Temperature:** `T_zone = T_supply + R_thermal × P_it` — higher load = hotter
- **Cooling Efficiency (COP):** `COP = 0.10 + 0.20 × T_supply` — higher setpoint = cheaper cooling
- **The Trade-off:** Raising the cooling setpoint saves energy but risks overheating

### The AI Controller (train.py)

- **Algorithm:** PPO (Proximal Policy Optimization) via Stable-Baselines3
- **Observation:** GPU utilization per zone, temperatures, current setpoint, queue length
- **Action:** Adjust cooling setpoint by ±1°C per step
- **Reward:** Minimize energy, with heavy penalties for thermal violations (safety first)

### Real-World Validation

ArcticFlow validates against **real Microsoft Azure VM CPU traces** (Azure Public Dataset V2) — not just synthetic data. The dashboard lets you toggle between synthetic and Azure trace workloads live.

---

## 📊 Key Features

| Feature | Description |
|---|---|
| **3D Datacenter View** | Interactive Three.js visualization of 6 racks with Azure branding |
| **Real-Time Telemetry** | Live GPU utilization, temperatures, power draw, PUE |
| **2D Thermal Heatmap** | Rack-level temperature grid color-coded green→red |
| **Optimization Panel** | Live AI recommendations (over-cooling, hotspots, consolidation) |
| **Azure Trace Toggle** | Switch between synthetic and real Azure VM workload data |
| **AI Assistant** | Azure OpenAI–powered chat with formatted markdown responses |
| **Day/Night Theme** | Full light/dark mode with Microsoft Azure color palette |
| **Dynamic Energy Stats** | Savings %, CO₂ offset, PUE — all reactive to workload |
| **GPU Fleet Status** | 6 clusters × 6 racks × 8 nodes (288 GPUs) with health indicators |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 22+
- Python 3.10+ (for RL pipeline)

### Run Locally

```bash
# 1) Start the backend
cd mock-backend
npm install
node src/server.js          # → ws://localhost:8080

# 2) Start the frontend (new terminal)
cd web
npm install
npm run dev                  # → http://localhost:5173
```

### Run the RL Pipeline (optional)

```bash
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

python model.py              # Validate physics + generate trade-off chart
python workload.py           # Generate workload curves
python train.py --heuristic  # Quick AI controller (greedy-safe)
python train.py --timesteps 200000  # Train PPO
python metrics.py            # Compare baseline vs AI
```

---

## ☁️ Deployed on Azure

| Component | Service | URL |
|---|---|---|
| Frontend | Azure Static Web Apps | [icy-coast-05e96330f.7.azurestaticapps.net](https://icy-coast-05e96330f.7.azurestaticapps.net) |
| Backend | Azure App Service (B3) | datacenterbackend-g6amh8ccafgsf0ed.canadacentral-01.azurewebsites.net |
| AI Chat | Azure OpenAI (GPT-4o-mini) | Integrated via backend |

CI/CD: Both deploy automatically on push to `azure-ai-integration` via GitHub Actions.

---

## 📁 Project Structure

```
├── web/                     # React + Vite + Three.js frontend
│   ├── src/App.tsx          # Main dashboard (charts, GPU grid, toggles)
│   ├── src/components/      # DataCenter3D, AIAssistant, ThermalHeatmap, OptimizationPanel
│   └── src/hooks/           # useTelemetry WebSocket hook
├── mock-backend/            # Node.js simulation backend
│   ├── src/server.js        # Express + WebSocket server
│   ├── src/simulator.js     # 288-node telemetry generator + Azure trace replay
│   ├── src/webSocket.js     # Telemetry broadcast + energy/PUE calculations
│   └── src/aiAssistant.js   # Azure OpenAI integration + ArcticFlow persona
├── data/                    # Azure VM CPU trace dataset (1,440 readings)
├── model.py                 # Physics engine (COP, PUE, thermal model)
├── workload.py              # Workload generator (synthetic + Azure trace)
├── env.py                   # Gymnasium environment (DCTwinEnv)
├── train.py                 # PPO training + greedy-safe heuristic
├── baselines.py             # Fixed + reactive baseline controllers
├── metrics.py               # Episode runner + comparison scoreboard
└── requirements.txt         # Python dependencies
```

---

## 💡 Impact at Scale

### Validated Results (PPO Training — 200K steps)

| Metric | Baseline (Fixed 20°C) | ArcticFlow AI |
|---|---|---|
| Cooling energy | 12.92 kWh | 11.49 kWh |
| **Energy saved** | — | **11.07%** ✅ (target ≥10%) |
| PUE | 1.244 | **1.217** |
| Thermal violations | 0 | **0** ✅ |
| SLA violations | 0 | **0** ✅ |

> The AI reward improved from -50,780 → -1,571 over training, demonstrating clear learning convergence.

### Extrapolated to a 1 MW Datacenter (per year)

| Metric | Value |
|---|---|
| Energy saved | **236,572 kWh** |
| Cost savings | **$28,389** |
| CO₂ avoided | **94.6 tonnes** |
| Equivalent | 🌳 ~4,300 trees planted |

Microsoft operates 60+ datacenter regions. At full fleet scale, this approach could save **millions in energy costs** and **thousands of tonnes of CO₂** annually.

---

## 🛠️ Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Three.js (react-three-fiber), Chart.js

**Backend:** Node.js, Express, WebSocket (ws), Azure OpenAI SDK, Azure Speech SDK

**AI/ML:** Python 3.10+, Gymnasium, Stable-Baselines3 (PPO), NumPy

**Cloud:** Azure Static Web Apps, Azure App Service, Azure OpenAI (GPT-4o-mini), GitHub Actions CI/CD

**Data:** Microsoft Azure Public VM Trace Dataset V2 (real-world CPU utilization)

---

## 👥 Team

Built during the **Microsoft Intern Hackathon 2026** 🏆

| Name | Role |
|---|---|
| Ivy Enyenihi | Team Lead |
| John Adeyemo | Full-Stack & AI Integration |
| Catherene Chimombo | Product Marketing |
| Emmanuel Alonge | Backend & Simulation |
| Enny Ademola | Cloud & Deployment |
| Trey De'De' | Frontend & UX |

---

## 📜 License

MIT — Built for the Microsoft Intern Hackathon 2026.
