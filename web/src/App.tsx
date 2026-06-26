import { useMemo, useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { useTelemetry } from './hooks/useTelemetry';
import { AIAssistant } from './components/AIAssistant';
import { DataCenter3D } from './components/DataCenter3D';
import { ThermalHeatmap } from './components/ThermalHeatmap';
import { OptimizationPanel } from './components/OptimizationPanel';

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler);

// Cluster type with geographic data
type Cluster = { 
  name: string; 
  status: 'active' | 'idle' | 'optimizing'; 
  gpu: number; 
  cooling: number; 
  power: number;
  site?: string;
  dataCenter?: string;
  lat?: number;
  lng?: number;
  spikeActive?: boolean;
};
type NodeData = {
  id: string;
  gpu: number;
  temp: number;
  cooling: number;
  power: number;
  status: 'active' | 'idle' | 'offline';
};
type ClusterData = {
  name: string;
  status: 'active' | 'idle' | 'optimizing';
  nodes: NodeData[];
  gpu: number;
  cooling: number;
  power: number;
  site?: string;
};

function Header({ connectionStatus, darkMode, onToggleTheme, workloadSource, onToggleWorkload }: { connectionStatus: string; darkMode: boolean; onToggleTheme: () => void; workloadSource: string; onToggleWorkload: () => void }) {
  const statusColors = {
    connected: 'bg-emerald-400',
    connecting: 'bg-amber-400',
    disconnected: 'bg-red-400',
    error: 'bg-red-500',
  };
  const statusLabels = {
    connected: 'Live Data Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    error: 'Connection Error',
  };
  return (
    <header className="sticky top-0 z-50 border-b border-blue-500/50 backdrop-blur transition-colors duration-300" style={{ background: 'var(--tm-header-bg)' }}>
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
        <div className="text-2xl font-bold bg-gradient-to-br from-[#50E6FF] to-[#0078D4] bg-clip-text text-transparent flex items-center gap-2">
          <span>❄️</span> ArcticFlow
        </div>
        <div className="flex items-center gap-4">
          {/* Workload source toggle */}
          <button
            onClick={onToggleWorkload}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-300 ${
              workloadSource === 'azure'
                ? 'bg-[#0078D4]/20 border-[#0078D4] text-[#0078D4]'
                : 'bg-[var(--tm-surface)] border-[var(--tm-border)] tm-text-muted hover:border-[var(--tm-border-hover)]'
            }`}
            title={workloadSource === 'azure' ? 'Using real Azure VM trace data' : 'Using synthetic workload'}
          >
            {workloadSource === 'azure' ? '📈 Azure Trace' : '🔄 Synthetic'}
          </button>
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-full border border-[var(--tm-border)] hover:border-[var(--tm-border-hover)] transition-all duration-300 text-xl"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? 'Switch to Day mode' : 'Switch to Night mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <div className={`tm-badge ${connectionStatus === 'connected' ? 'tm-badge-green' : connectionStatus === 'connecting' ? 'bg-yellow-400/20 text-yellow-700 dark:text-yellow-300' : 'bg-red-400/20 text-red-700 dark:text-red-300'}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${statusColors[connectionStatus as keyof typeof statusColors] || 'bg-slate-400'} ${connectionStatus === 'connected' || connectionStatus === 'connecting' ? 'tm-pulse' : ''}`} />
            {statusLabels[connectionStatus as keyof typeof statusLabels] || 'Unknown'}
          </div>
        </div>
      </div>
    </header>
  );
}

function HeroStats({ stats }: { stats: { energySavings: number; co2OffsetKg: number; powerDrawMW: number; coolingPUE: number; outsideAirC?: number; pueInBand?: boolean } | null }) {
  const card = 'tm-glass p-6 hover:translate-y-[-2px] transition-transform border-blue-500/30 hover:border-blue-500/60';
  const energySavings = stats?.energySavings ?? 0;
  const co2Offset = stats?.co2OffsetKg ?? 0;
  const powerDraw = stats?.powerDrawMW ?? 0;
  const coolingPUE = stats?.coolingPUE ?? 0;
  const outsideAirC = stats?.outsideAirC;
  const pueInBand = stats?.pueInBand;
  return (
    <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 mb-6">
      <div className={card}>
        <div className="uppercase tracking-wider tm-text-muted text-xs">Energy Savings</div>
        <div className="text-4xl font-bold bg-gradient-to-br from-sky-400 to-blue-500 bg-clip-text text-transparent">
          {energySavings.toFixed(1)}%
        </div>
        <div className="tm-text-muted text-xs mt-2">vs traditional cooling</div>
      </div>
      <div className={card}>
        <div className="uppercase tracking-wider tm-text-muted text-xs">CO₂ Saved / Day</div>
        <div className="text-4xl font-bold text-green-600 dark:text-green-400">
          {co2Offset}<span className="text-lg"> kg</span>
        </div>
        <div className="tm-text-muted text-xs mt-2">≈ {Math.max(1, Math.round(co2Offset / 22))} trees · {Math.round(co2Offset * 365 / 1000)} tonnes/yr</div>
      </div>
      <div className={card}>
        <div className="uppercase tracking-wider tm-text-muted text-xs">Current Power Draw</div>
        <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
          {powerDraw.toFixed(2)}<span className="text-lg"> MW</span>
        </div>
        <div className="tm-text-muted text-xs mt-2">IT + cooling (288 nodes)</div>
      </div>
      <div className={card}>
        <div className="uppercase tracking-wider tm-text-muted text-xs">Cooling Efficiency (PUE)</div>
        <div className="text-4xl font-bold text-yellow-600 dark:text-yellow-400">
          {coolingPUE.toFixed(2)}
        </div>
        <div className="tm-text-muted text-xs mt-2">
          {pueInBand ? (
            <span className="text-green-600 dark:text-green-400">✓ within published 1.1–1.6 band</span>
          ) : (
            'Lower is better (ideal: 1.0)'
          )}
          {typeof outsideAirC === 'number' && (
            <span> · outside air {Math.round(outsideAirC)}°C</span>
          )}
        </div>
      </div>
    </section>
  );
}

function useChartData(chartData?: { labels: string[]; datasets: { label: string; data: number[] }[] }, darkMode: boolean = true) {
  const data = useMemo(() => {
    if (!chartData || !chartData.labels || !chartData.datasets) {
      return {
        labels: [],
        datasets: [
          { label: 'GPU Utilization %', data: [], borderColor: '#0078D4', backgroundColor: 'rgba(0,120,212,0.1)', tension: 0.4, fill: true },
          { label: 'Cooling Power %', data: [], borderColor: '#FFB900', backgroundColor: 'rgba(255,185,0,0.1)', tension: 0.4, fill: true },
          { label: 'Energy Savings %', data: [], borderColor: '#50E6FF', backgroundColor: 'rgba(80,230,255,0.1)', tension: 0.4, fill: true },
        ],
      };
    }
    return {
      labels: chartData.labels,
      datasets: chartData.datasets.map((ds, idx) => {
        const colors = ['#0078D4', '#FFB900', '#50E6FF'];
        const bgColors = ['rgba(0,120,212,0.1)', 'rgba(255,185,0,0.1)', 'rgba(80,230,255,0.1)'];
        return {
          label: ds.label,
          data: ds.data,
          borderColor: colors[idx] || '#00d4ff',
          backgroundColor: bgColors[idx] || 'rgba(0,212,255,0.1)',
          tension: 0.4,
          fill: true,
        };
      }),
    };
  }, [chartData]);

  const options = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: darkMode ? '#e0e6ed' : '#1b1b1b' } } },
    scales: {
      y: { beginAtZero: true, max: 100, ticks: { color: darkMode ? '#8b95a5' : '#505050' }, grid: { color: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)' } },
      x: { ticks: { color: darkMode ? '#8b95a5' : '#505050' }, grid: { color: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)' } },
    },
  }), [darkMode]);

  return { data, options };
}

function GPUGrid({ nodes }: { nodes: { id: number; label: string; clusterName: string; state: 'active' | 'hot' | 'idle'; gpuLoad: number; temperature: string; status: string }[] }) {
  const counts = useMemo(() => {
    let active = 0, hot = 0, idle = 0;
    nodes.forEach(n => {
      if (n.state === 'active') active++;
      else if (n.state === 'hot') hot++;
      else if (n.state === 'idle') idle++;
    });
    return { active, hot, idle, total: nodes.length };
  }, [nodes]);

  // Group nodes by cluster and compute per-cluster stats
  const clusterStats = useMemo(() => {
    const groups: { [key: string]: typeof nodes } = {};
    nodes.forEach(n => {
      if (!groups[n.clusterName]) groups[n.clusterName] = [];
      groups[n.clusterName].push(n);
    });

    return Object.keys(groups).sort().map(name => {
      const clusterNodes = groups[name];
      const active = clusterNodes.filter(n => n.state === 'active').length;
      const hot = clusterNodes.filter(n => n.state === 'hot').length;
      const idle = clusterNodes.filter(n => n.state === 'idle').length;
      const offline = clusterNodes.filter(n => n.status === 'offline').length;
      const avgGpu = Math.round(clusterNodes.reduce((s, n) => s + n.gpuLoad, 0) / clusterNodes.length);
      const maxTemp = Math.max(...clusterNodes.map(n => parseFloat(n.temperature) || 0));
      const totalNodes = clusterNodes.length;

      return { name, totalNodes, active, hot, idle, offline, avgGpu, maxTemp };
    });
  }, [nodes]);

  return (
    <div className="mt-6">
      {/* Cluster summary cards — compact rack-level view */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {clusterStats.map(cluster => {
          const hotPct = (cluster.hot / cluster.totalNodes) * 100;
          const activePct = (cluster.active / cluster.totalNodes) * 100;
          const idlePct = (cluster.idle / cluster.totalNodes) * 100;
          
          // Overall health indicator
          const health = cluster.hot > cluster.totalNodes * 0.5 ? 'critical' 
            : cluster.hot > cluster.totalNodes * 0.25 ? 'warning' : 'healthy';
          const healthBorder = health === 'critical' ? 'border-red-500/60' 
            : health === 'warning' ? 'border-yellow-500/60' : '';

          return (
            <div key={cluster.name} className={`tm-card ${healthBorder}`}>
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tm-text-primary">Cluster {cluster.name}</span>
                  <span className="text-[10px] tm-text-muted">{cluster.totalNodes} nodes · 6 racks</span>
                </div>
                <span className="text-xs font-semibold" style={{ color: health === 'critical' ? '#ef4444' : health === 'warning' ? '#eab308' : '#0078D4' }}>
                  {cluster.avgGpu}% avg
                </span>
              </div>

              {/* Stacked utilization bar */}
              <div className="h-3 rounded-full overflow-hidden flex tm-bar-bg mb-2">
                <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${hotPct}%` }} title={`Hot: ${cluster.hot}`} />
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${activePct}%` }} title={`Active: ${cluster.active}`} />
                <div className="h-full bg-slate-400 transition-all duration-500" style={{ width: `${idlePct}%` }} title={`Idle: ${cluster.idle}`} />
              </div>

              {/* Mini stats row */}
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex gap-3">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{cluster.active} active</span>
                  <span className="text-red-600 dark:text-red-400 font-medium">{cluster.hot} hot</span>
                  <span className="tm-text-muted">{cluster.idle} idle</span>
                </div>
                {cluster.offline > 0 && (
                  <span className="text-red-500 font-medium">{cluster.offline} offline</span>
                )}
              </div>

              {/* Max temp indicator */}
              <div className="mt-1.5 text-[10px] tm-text-muted">
                Peak temp: <span className={cluster.maxTemp > 35 ? 'text-red-500 font-semibold' : 'tm-text-detail'}>{cluster.maxTemp.toFixed(1)}°C</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall fleet legend */}
      <div className="flex gap-6 justify-center mt-4 flex-wrap text-sm tm-text-muted">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Active: {counts.active}/{counts.total}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Hot: {counts.hot}/{counts.total}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-slate-400 inline-block" /> Idle: {counts.idle}/{counts.total}
        </div>
      </div>
    </div>
  );
}

function ClusterList({ clusters, onClusterClick }: { clusters: Cluster[]; onClusterClick: (cluster: Cluster) => void }) {
  return (
    <div className="cluster-list-scroll flex-1 overflow-y-auto pr-1.5 space-y-3 pb-2" style={{ maxHeight: 'calc(300px + 450px)' }}>
      {clusters.map((cluster) => {
        const gpuLoad = Math.round(cluster.gpu);
        const cooling = Math.round(cluster.cooling);
        const coolingDiff = cooling - gpuLoad;
        
        // Extract cluster letter from name (e.g., "Cluster A" -> "A")
        const clusterLetter = cluster.name?.replace('Cluster ', '') || '';
        // Build display name: "Houston, USA Cluster (A)"
        const displayName = cluster.site 
          ? `${cluster.site} Cluster (${clusterLetter})`
          : cluster.name;
        
        // Generate dynamic status info based on ACTUAL data
        let statusInfo;
        
        if (cluster.status === 'active') {
          if (gpuLoad > 70) {
            statusInfo = {
              color: 'bg-emerald-400/20 text-emerald-700 dark:text-emerald-300',
              detail: `Processing AI tasks at ${gpuLoad}% capacity`,
              icon: '🔥',
              label: 'ACTIVE'
            };
          } else {
            statusInfo = {
              color: 'bg-emerald-400/20 text-emerald-700 dark:text-emerald-300',
              detail: `Load ${gpuLoad}% ↔ Cooling ${cooling}% (Well matched)`,
              icon: '✅',
              label: 'ACTIVE'
            };
          }
        } else if (cluster.status === 'optimizing') {
          if (coolingDiff > 15) {
            statusInfo = {
              color: 'bg-cyan-400/20 text-cyan-700 dark:text-cyan-300',
              detail: `AI reducing cooling: ${cooling}% → ${gpuLoad}% (Save ${Math.abs(coolingDiff)}%)`,
              icon: '⚙️',
              label: 'OPTIMIZING'
            };
          } else if (coolingDiff < -15) {
            statusInfo = {
              color: 'bg-amber-400/20 text-amber-700 dark:text-amber-300',
              detail: `AI increasing cooling: ${cooling}% → ${gpuLoad}% (+${Math.abs(coolingDiff)}%)`,
              icon: '🌡️',
              label: 'OPTIMIZING'
            };
          } else {
            statusInfo = {
              color: 'bg-cyan-400/20 text-cyan-700 dark:text-cyan-300',
              detail: `Fine-tuning to match ${gpuLoad}% workload`,
              icon: '⚙️',
              label: 'OPTIMIZING'
            };
          }
        } else {
          // idle
          statusInfo = {
            color: 'bg-slate-400/20 tm-text-muted',
            detail: `Minimal workload - conserving energy`,
            icon: '💤',
            label: 'IDLE'
          };
        }
        
        return (
          <div 
            key={cluster.name} 
            className="tm-cluster-item cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            onClick={() => onClusterClick(cluster)}
            title="Click to view in 3D"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1">
                <div className="font-semibold text-base flex items-center gap-2">
                  {displayName}
                  <span className="text-xs tm-text-primary opacity-60">🎯 View 3D</span>
                </div>
                <div className="text-xs tm-text-primary mt-0.5">{statusInfo.detail}</div>
              </div>
              <div className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusInfo.color}`}>
                {statusInfo.icon} {statusInfo.label}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="tm-text-muted text-xs mb-1">Avg GPU</div>
                <div className="font-semibold text-lg">{gpuLoad}%</div>
              </div>
              <div>
                <div className="tm-text-muted text-xs mb-1">Avg Cooling</div>
                <div className="font-semibold text-lg">{cooling}%</div>
              </div>
              <div>
                <div className="tm-text-muted text-xs mb-1">Total Power</div>
                <div className="font-semibold text-lg">{cluster.power}<span className="text-xs tm-text-muted">kW</span></div>
              </div>
            </div>
            <div className="mt-3 h-1.5 tm-progress-bg rounded overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#0078D4] to-[#50E6FF] rounded transition-all duration-500" style={{ width: `${gpuLoad}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
  const { telemetry, status, wsRef } = useTelemetry(WS_URL);
  const [selected3DClusterName, setSelected3DClusterName] = useState<string | null>(null);

  // Theme state (persisted in localStorage)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('arcticflow-theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.remove('light');
    } else {
      root.classList.add('light');
    }
    localStorage.setItem('arcticflow-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleTheme = () => setDarkMode(prev => !prev);

  // Workload source toggle
  const workloadSource = telemetry?.workloadSource || 'synthetic';
  const toggleWorkloadSource = () => {
    const newSource = workloadSource === 'synthetic' ? 'azure' : 'synthetic';
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set-workload-source', source: newSource }));
    }
  };

  const { data, options } = useChartData(telemetry?.chart, darkMode);

  // Convert cluster data to 3D format with node details (runs on every telemetry update)
  const buildClusterData = (clusterName: string): ClusterData | null => {
    const cluster = telemetry?.clusters.find(c => c.name === clusterName);
    if (!cluster) return null;

    // Extract the letter from "Cluster A" -> "A"
    const clusterLetter = clusterName.replace('Cluster ', '');

    const clusterNodes = (telemetry?.nodes || [])
      .filter(node => node.clusterName === clusterLetter)
      .map(node => {
        // Parse temperature - remove °C and convert to number
        const tempStr = node.temperature?.toString() || '0';
        const tempValue = parseFloat(tempStr.replace('°C', '').replace('°', '').trim()) || 0;
        
        return {
          id: node.label,
          gpu: node.gpuLoad || 0,
          temp: tempValue,
          cooling: node.cooling || 0,  // Use node's individual cooling, not cluster average
          power: node.powerUsage || 0,  // Use node's individual power, not calculated
          status: (node.status === 'offline' ? 'offline' : node.state === 'idle' ? 'idle' : 'active') as 'active' | 'idle' | 'offline'
        };
      });

    return {
      name: cluster.name,
      status: cluster.status,
      nodes: clusterNodes,
      gpu: cluster.gpu,
      cooling: cluster.cooling,
      power: cluster.power,
      site: (cluster as any).site
    };
  };

  const handleClusterClick = (cluster: Cluster) => {
    setSelected3DClusterName(cluster.name);
  };

  // Cluster view mode (list vs thermal heatmap)
  const [clusterView, setClusterView] = useState<'list' | 'heatmap'>('list');

  // Build live cluster data whenever telemetry updates
  const liveClusterData = selected3DClusterName ? buildClusterData(selected3DClusterName) : null;

  // If 3D view is active, show it fullscreen with live data
  if (selected3DClusterName && liveClusterData) {
    return <DataCenter3D cluster={liveClusterData} onClose={() => setSelected3DClusterName(null)} />;
  }

  return (
    <div className="min-h-dvh">
      <Header connectionStatus={status} darkMode={darkMode} onToggleTheme={toggleTheme} workloadSource={workloadSource} onToggleWorkload={toggleWorkloadSource} />
      <main className="max-w-[1600px] mx-auto p-6">
        <HeroStats stats={telemetry?.stats || null} />


        <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-6">
          <div className="tm-panel">
            <div className="tm-divider">
              <div className="text-lg font-semibold flex items-center gap-2">
                📊 Real-Time Energy &amp; Workload
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  workloadSource === 'azure'
                    ? 'bg-[#0078D4]/20 text-[#50E6FF] border border-[#0078D4]/40'
                    : 'bg-slate-500/20 tm-text-muted border border-slate-500/30'
                }`}>
                  {workloadSource === 'azure' ? '🔵 Azure VM Trace' : '⚪ Synthetic'}
                </span>
              </div>
            </div>
            <div className="relative h-[300px]">
              <Line data={data} options={options} />
            </div>
            <div className="mt-6 pt-6 border-t border-[#0078D4]/30 mb-14">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">
                    🖥️ GPU Fleet Status — 6 Clusters · 36 Racks · {telemetry?.nodes?.length || 0} Nodes
                </h3>
              </div>
              <GPUGrid nodes={telemetry?.nodes || []} />
            </div>
          </div>
          <div className="tm-panel">
            <div className="tm-divider flex items-center justify-between">
              <div className="text-lg font-semibold flex items-center gap-2">
                🖥️ GPU Clusters
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setClusterView('list')}
                  className={`text-xs px-2 py-1 rounded transition ${clusterView === 'list' ? 'bg-[#0078D4]/20 text-[#50E6FF]' : 'tm-text-muted hover:text-[#50E6FF]'}`}
                >
                  📋 List
                </button>
                <button
                  onClick={() => setClusterView('heatmap')}
                  className={`text-xs px-2 py-1 rounded transition ${clusterView === 'heatmap' ? 'bg-[#0078D4]/20 text-[#50E6FF]' : 'tm-text-muted hover:text-[#50E6FF]'}`}
                  title="2D Thermal Heatmap — lighter on bandwidth"
                >
                  🌡️ Thermal
                </button>
              </div>
            </div>
            
            {clusterView === 'heatmap' ? (
              <ThermalHeatmap nodes={telemetry?.nodes || []} />
            ) : (
              <ClusterList clusters={telemetry?.clusters || []} onClusterClick={handleClusterClick} />
            )}
          </div>
        </section>

        {/* Optimization Recommendations */}
        <OptimizationPanel stats={telemetry?.stats || null} nodes={telemetry?.nodes || []} />
      </main>
      
      {/* AI Assistant */}
  <AIAssistant wsRef={wsRef} connectionStatus={status} />
    </div>
  );
}

export default App;
