import { useMemo, useState } from 'react';
import ClusterMap from './components/ClusterMap';
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

function Header({ connectionStatus }: { connectionStatus: string }) {
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
    <header className="sticky top-0 z-50 bg-slate-900/95 border-b border-cyan-400/50 backdrop-blur">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
        <div className="text-2xl font-bold bg-gradient-to-br from-cyan-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
          <span>🧊</span> ThermaMind
        </div>
        <div className={`tm-badge ${connectionStatus === 'connected' ? 'tm-badge-green' : connectionStatus === 'connecting' ? 'bg-amber-400/20 text-amber-300' : 'bg-red-400/20 text-red-300'}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${statusColors[connectionStatus as keyof typeof statusColors] || 'bg-slate-400'} ${connectionStatus === 'connected' || connectionStatus === 'connecting' ? 'tm-pulse' : ''}`} />
          {statusLabels[connectionStatus as keyof typeof statusLabels] || 'Unknown'}
        </div>
      </div>
    </header>
  );
}

function HeroStats({ stats }: { stats: { energySavings: number; co2OffsetKg: number; powerDrawMW: number; coolingPUE: number; outsideAirC?: number; pueInBand?: boolean } | null }) {
  const card = 'tm-glass p-6 hover:translate-y-[-2px] transition-transform border-cyan-400/30 hover:border-cyan-400/60';
  const energySavings = stats?.energySavings ?? 0;
  const co2Offset = stats?.co2OffsetKg ?? 0;
  const powerDraw = stats?.powerDrawMW ?? 0;
  const coolingPUE = stats?.coolingPUE ?? 0;
  const outsideAirC = stats?.outsideAirC;
  const pueInBand = stats?.pueInBand;
  return (
    <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 mb-6">
      <div className={card}>
        <div className="uppercase tracking-wider text-slate-400 text-xs">Energy Savings</div>
        <div className="text-4xl font-bold bg-gradient-to-br from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          {energySavings.toFixed(1)}%
        </div>
        <div className="text-slate-400 text-xs mt-2">vs traditional cooling</div>
      </div>
      <div className={card}>
        <div className="uppercase tracking-wider text-slate-400 text-xs">CO₂ Offset Today</div>
        <div className="text-4xl font-bold text-emerald-400">
          {co2Offset}<span className="text-lg"> kg</span>
        </div>
        <div className="text-slate-400 text-xs mt-2">≈ {Math.round(co2Offset / 22)} trees planted</div>
      </div>
      <div className={card}>
        <div className="uppercase tracking-wider text-slate-400 text-xs">Current Power Draw</div>
        <div className="text-4xl font-bold text-cyan-400">
          {powerDraw.toFixed(2)}<span className="text-lg"> MW</span>
        </div>
        <div className="text-slate-400 text-xs mt-2">Global operations</div>
      </div>
      <div className={card}>
        <div className="uppercase tracking-wider text-slate-400 text-xs">Cooling Efficiency (PUE)</div>
        <div className="text-4xl font-bold text-amber-400">
          {coolingPUE.toFixed(2)}
        </div>
        <div className="text-slate-400 text-xs mt-2">
          {pueInBand ? (
            <span className="text-emerald-400">✓ within published 1.1–1.6 band</span>
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

function useChartData(chartData?: { labels: string[]; datasets: { label: string; data: number[] }[] }) {
  const data = useMemo(() => {
    if (!chartData || !chartData.labels || !chartData.datasets) {
      return {
        labels: [],
        datasets: [
          { label: 'GPU Utilization %', data: [], borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', tension: 0.4, fill: true },
          { label: 'Cooling Power %', data: [], borderColor: '#ffa500', backgroundColor: 'rgba(255,165,0,0.1)', tension: 0.4, fill: true },
          { label: 'Energy Savings %', data: [], borderColor: '#00ffaa', backgroundColor: 'rgba(0,255,170,0.1)', tension: 0.4, fill: true },
        ],
      };
    }
    return {
      labels: chartData.labels,
      datasets: chartData.datasets.map((ds, idx) => {
        const colors = ['#00d4ff', '#ffa500', '#00ffaa'];
        const bgColors = ['rgba(0,212,255,0.1)', 'rgba(255,165,0,0.1)', 'rgba(0,255,170,0.1)'];
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
    plugins: { legend: { labels: { color: '#e0e6ed' } } },
    scales: {
      y: { beginAtZero: true, max: 100, ticks: { color: '#8b95a5' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      x: { ticks: { color: '#8b95a5' }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  }), []);

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
    return { active, hot, idle };
  }, [nodes]);

  // Group nodes by cluster
  const groupedNodes = useMemo(() => {
    const groups: { [key: string]: typeof nodes } = {};
    nodes.forEach(n => {
      if (!groups[n.clusterName]) groups[n.clusterName] = [];
      groups[n.clusterName].push(n);
    });
    return groups;
  }, [nodes]);

  // Get unique cluster names sorted alphabetically
  const clusterNames = useMemo(() => {
    return Object.keys(groupedNodes).sort();
  }, [groupedNodes]);

  // Calculate dynamic grid columns based on cluster count
  const gridColsClass = useMemo(() => {
    const count = clusterNames.length;
    if (count <= 4) return 'grid-cols-4';
    if (count <= 6) return 'grid-cols-6';
    return 'grid-cols-4'; // 8 clusters = 4 cols x 2 rows
  }, [clusterNames.length]);

  return (
    <div className="mt-6">
      {/* Grid with visual cluster grouping */}
      <div className={`grid ${gridColsClass} gap-3`}>
        {clusterNames.map(clusterName => (
          <div key={clusterName} className="space-y-2">
            <div className="text-xs font-semibold text-cyan-400 text-center">Cluster {clusterName}</div>
            <div className="grid grid-cols-4 gap-1.5 p-2 bg-slate-900/30 rounded-lg border border-cyan-400/20">
              {(groupedNodes[clusterName] || []).map(n => {
                // Build contextual tooltip based on status
                let statusText = '';
                if (n.status === 'offline') {
                  statusText = '🔴 OFFLINE - Node down';
                } else if (n.state === 'hot') {
                  statusText = `🔥 HEAVY LOAD\nGPU: ${n.gpuLoad}% • Temp: ${n.temperature}°C\nHigh workload - cooling at max`;
                } else if (n.state === 'active') {
                  statusText = `✅ ACTIVE\nGPU: ${n.gpuLoad}% • Temp: ${n.temperature}°C\nProcessing tasks normally`;
                } else {
                  statusText = `💤 IDLE\nGPU: ${n.gpuLoad}% • Temp: ${n.temperature}°C\nMinimal workload - low power`;
                }
                
                return (
                  <div 
                    key={n.id} 
                    className={`gpu-node ${n.state === 'idle' ? 'gpu-idle' : n.state === 'hot' ? 'gpu-hot' : 'gpu-active'}`} 
                    data-label={n.label}
                    title={`Cluster ${n.clusterName} - Node ${n.label}\n${statusText}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex gap-6 justify-center mt-4 flex-wrap text-sm">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Active: 30-75% Load (<span id="activeCount">{counts.active}</span>)</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Hot: &gt;75% Load (<span id="hotCount">{counts.hot}</span>)</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-slate-500 inline-block" /> Idle: &lt;30% Load or Offline (<span id="idleCount">{counts.idle}</span>)</div>
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
              color: 'bg-emerald-400/20 text-emerald-300',
              detail: `Processing AI tasks at ${gpuLoad}% capacity`,
              icon: '🔥',
              label: 'ACTIVE'
            };
          } else {
            statusInfo = {
              color: 'bg-emerald-400/20 text-emerald-300',
              detail: `Load ${gpuLoad}% ↔ Cooling ${cooling}% (Well matched)`,
              icon: '✅',
              label: 'ACTIVE'
            };
          }
        } else if (cluster.status === 'optimizing') {
          if (coolingDiff > 15) {
            statusInfo = {
              color: 'bg-cyan-400/20 text-cyan-300',
              detail: `AI reducing cooling: ${cooling}% → ${gpuLoad}% (Save ${Math.abs(coolingDiff)}%)`,
              icon: '⚙️',
              label: 'OPTIMIZING'
            };
          } else if (coolingDiff < -15) {
            statusInfo = {
              color: 'bg-amber-400/20 text-amber-300',
              detail: `AI increasing cooling: ${cooling}% → ${gpuLoad}% (+${Math.abs(coolingDiff)}%)`,
              icon: '🌡️',
              label: 'OPTIMIZING'
            };
          } else {
            statusInfo = {
              color: 'bg-cyan-400/20 text-cyan-300',
              detail: `Fine-tuning to match ${gpuLoad}% workload`,
              icon: '⚙️',
              label: 'OPTIMIZING'
            };
          }
        } else {
          // idle
          statusInfo = {
            color: 'bg-slate-400/20 text-slate-400',
            detail: `Minimal workload - conserving energy`,
            icon: '💤',
            label: 'IDLE'
          };
        }
        
        return (
          <div 
            key={cluster.name} 
            className="bg-slate-900/50 rounded-lg border-l-4 border-cyan-400 p-4 hover:bg-slate-900/70 transition cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            onClick={() => onClusterClick(cluster)}
            title="Click to view in 3D"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1">
                <div className="font-semibold text-base flex items-center gap-2">
                  {displayName}
                  <span className="text-xs text-cyan-400/60">🎯 View 3D</span>
                </div>
                <div className="text-xs text-cyan-400 mt-0.5">{statusInfo.detail}</div>
              </div>
              <div className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusInfo.color}`}>
                {statusInfo.icon} {statusInfo.label}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-slate-400 text-xs mb-1">Avg GPU</div>
                <div className="font-semibold text-lg">{gpuLoad}%</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Avg Cooling</div>
                <div className="font-semibold text-lg">{cooling}%</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Total Power</div>
                <div className="font-semibold text-lg">{cluster.power}<span className="text-xs text-slate-400">kW</span></div>
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-white/10 rounded overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded transition-all duration-500" style={{ width: `${gpuLoad}%` }} />
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
  const { data, options } = useChartData(telemetry?.chart);
  const [selected3DClusterName, setSelected3DClusterName] = useState<string | null>(null);

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

  // Map view state
  const [showMap, setShowMap] = useState(false);

  // Build live cluster data whenever telemetry updates
  const liveClusterData = selected3DClusterName ? buildClusterData(selected3DClusterName) : null;

  // If 3D view is active, show it fullscreen with live data
  if (selected3DClusterName && liveClusterData) {
    return <DataCenter3D cluster={liveClusterData} onClose={() => setSelected3DClusterName(null)} />;
  }

  return (
    <div className="min-h-dvh">
      <Header connectionStatus={status} />
      <main className="max-w-[1600px] mx-auto p-6">
        <HeroStats stats={telemetry?.stats || null} />


        <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-6">
          <div className="tm-panel">
            <div className="tm-divider">
              <div className="text-lg font-semibold">📊 Real-Time Energy &amp; Workload</div>
            </div>
            <div className="relative h-[300px]">
              <Line data={data} options={options} />
            </div>
            <div className="mt-6 pt-6 border-t border-cyan-400/20 mb-14">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">
                  🖥️ GPU Cluster Status ({telemetry?.nodes?.length || 0} Nodes)
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
              <button
                onClick={() => setShowMap(!showMap)}
                className="text-cyan-400 hover:text-emerald-400 text-sm font-medium transition"
              >
                {showMap ? '📊 View List' : '🌎 View Map'} ↗
              </button>
            </div>
            
            {showMap ? (
              <div className="flex-1 overflow-hidden">
                <ClusterMap clusters={(telemetry?.clusters || []) as any} />
              </div>
            ) : (
              <ClusterList clusters={telemetry?.clusters || []} onClusterClick={handleClusterClick} />
            )}
          </div>
        </section>
      </main>
      
      {/* AI Assistant */}
  <AIAssistant wsRef={wsRef} connectionStatus={status} />
    </div>
  );
}

export default App;
