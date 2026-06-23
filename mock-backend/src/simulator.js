// src/simulator.js
import { getClusterState } from "./stateMachine.js";

// 🧊 Cooling state tracker (simulates physical cooling system lag)
const coolingState = {
  A: { current: 50, target: 50, lastGpuLoad: 50 },
  B: { current: 35, target: 35, lastGpuLoad: 35 },
  C: { current: 50, target: 50, lastGpuLoad: 50 },
  D: { current: 35, target: 35, lastGpuLoad: 35 },
  E: { current: 55, target: 55, lastGpuLoad: 55 },
  F: { current: 40, target: 40, lastGpuLoad: 40 },
  G: { current: 48, target: 48, lastGpuLoad: 48 },
  H: { current: 45, target: 45, lastGpuLoad: 45 }
};

// 🌍 Global ConocoPhillips data center / operations hub coordinates
const globalLocations = [
  { name: "Houston, USA", lat: 29.7604, lng: -95.3698 },
  { name: "Calgary, Canada", lat: 51.0447, lng: -114.0719 },
  { name: "Stavanger, Norway", lat: 58.9699756, lng: 5.7331073 },
  { name: "Doha, Qatar", lat: 25.2854, lng: 51.531 },
  { name: "Perth, Australia", lat: -31.9505, lng: 115.8605 },
  { name: "Jakarta, Indonesia", lat: -6.2088, lng: 106.8456 },
  { name: "Anchorage, Alaska", lat: 61.2181, lng: -149.9003 },
  { name: "Beijing, China", lat: 39.9042, lng: 116.4074 },
];

// 🗺️ Regional data center naming by ConocoPhillips zones
const dataCenters = {
  "Houston, USA": "North America Data Center",
  "Calgary, Canada": "Canadian AI Hub",
  "Stavanger, Norway": "Nordic Energy Cluster",
  "Doha, Qatar": "MENA Operations Hub",
  "Perth, Australia": "Asia-Pacific Cluster",
  "Jakarta, Indonesia": "Indonesia Field Systems",
  "Anchorage, Alaska": "Arctic Compute Node",
  "Beijing, China": "China AI Operations",
};

// 🏢 Generate a single GPU cluster (a group of 8 GPU nodes)
function generateCluster(clusterName, clusterIndex) {
  const now = new Date().toLocaleTimeString();
  
  // Each cluster has different characteristics
  const clusterProfiles = [
    { name: 'A', gpuBias: 20, location: 'Houston', workload: 'Training' },      // High load cluster
    { name: 'B', gpuBias: -15, location: 'Calgary', workload: 'Inference' },    // Low load cluster
    { name: 'C', gpuBias: 5, location: 'Stavanger', workload: 'Training' },     // Medium cluster
    { name: 'D', gpuBias: -20, location: 'Doha', workload: 'Development' },     // Idle cluster
    { name: 'E', gpuBias: 15, location: 'Perth', workload: 'Seismic Analysis' }, // High load
    { name: 'F', gpuBias: -10, location: 'Jakarta', workload: 'Field Data' },   // Low-medium load
    { name: 'G', gpuBias: 10, location: 'Anchorage', workload: 'Research' },    // Medium-high load
    { name: 'H', gpuBias: 0, location: 'Beijing', workload: 'AI Models' },      // Balanced load
  ];
  
  const profile = clusterProfiles[clusterIndex] || clusterProfiles[0];
  const clusterCooling = coolingState[profile.name];

  // 🌎 Assign each cluster to a global site
  const globalSite = globalLocations[clusterIndex % globalLocations.length];
  const dataCenterName = dataCenters[globalSite.name] || "Unknown Facility";

  // ⚡ Spike Logic — check if a regional or global spike is active
  const { loadMultiplier, region, status } = getClusterState();
  const isAffected =
    region === "global" ||
    globalSite.name.toLowerCase().includes(region.toLowerCase()) ||
    profile.location.toLowerCase().includes(region.toLowerCase());
  
  // Generate 8 GPU nodes for this cluster
  const nodes = [];
  let totalGpu = 0;
  let totalCooling = 0;
  let totalPower = 0;
  
  for (let i = 0; i < 8; i++) {
    const nodeId = clusterIndex * 8 + i + 1; // Global node ID (1-32)
    const nodeLabel = `${profile.name}${i + 1}`; // e.g., A1, A2, ..., B1, B2, etc.
    
    // Apply spike multiplier to affected clusters only
    const rawGpu = 50 + profile.gpuBias + (Math.random() * 30 - 15);
    const adjustedGpu = isAffected ? rawGpu * loadMultiplier : rawGpu;
    const gpuLoad = Math.min(100, Math.max(0, Math.floor(adjustedGpu)));
    
    // 🌡️ REALISTIC COOLING CALCULATION
    // In real world: Cooling responds to GPU load, but with lag and inefficiency
    
    // Calculate what cooling SHOULD be (ideal with AI optimization)
    const idealCooling = gpuLoad + 5; // Need slightly more cooling than load (thermal headroom)
    
    // Traditional data centers over-cool by 15-30% (wasteful but "safe")
    const traditionalOverCooling = Math.random() > 0.7 ? 25 : 15; // Sometimes way over-cooled
    
    // AI optimization: Gradually adjust cooling toward ideal
    // But not instantly - physical systems have inertia
    let nodeCooling;
    if (Math.random() > 0.3) {
      // 70% of time: AI-optimized cooling (closer to ideal)
      nodeCooling = idealCooling + Math.floor(Math.random() * 10 - 5); // Within ±5% of ideal
    } else {
      // 30% of time: Still adjusting from over-cooling (system catching up)
      nodeCooling = gpuLoad + traditionalOverCooling;
    }
    
    nodeCooling = Math.min(100, Math.max(0, nodeCooling));
    
    const temperature = 20 + gpuLoad * 0.2 + (Math.random() * 4 - 2);
    
    // More realistic power calculation (servers have base power + load power)
    // Base power: ~1.5 kW idle, scales up to ~6 kW at full load
    const basePower = 1.5; // kW - idle power consumption
    const loadPower = (gpuLoad / 100) * 4.5; // kW - additional power from GPU load
    const coolingPower = (nodeCooling / 100) * 0.8; // kW - cooling fans power
    const powerUsage = parseFloat((basePower + loadPower + coolingPower).toFixed(2));
    
    // 2% chance any individual node is offline
    const status = Math.random() < 0.02 ? "offline" : "online";
    
    nodes.push({
      id: nodeId,
      label: nodeLabel,
      clusterName: profile.name,
      gpuLoad: status === "offline" ? 0 : gpuLoad,
      cooling: status === "offline" ? 0 : nodeCooling,
      temperature: status === "offline" ? 0 : temperature,
      powerUsage: status === "offline" ? 0 : powerUsage,
      status
    });
    
    totalGpu += nodes[i].gpuLoad;
    totalCooling += nodes[i].cooling;
    totalPower += nodes[i].powerUsage;
  }
  
  // Cluster-level aggregated stats
  const avgGpu = Math.round(totalGpu / 8);
  const avgCooling = Math.round(totalCooling / 8);
  const clusterStatus = nodes.every(n => n.status === "offline") ? "offline" : "online";
  
  // 🧮 Regional temperature bias
  let regionalTempBias = 0;
  if (globalSite.name.includes("Norway")) regionalTempBias = -3;
  else if (globalSite.name.includes("Canada")) regionalTempBias = -2;
  else if (globalSite.name.includes("UK")) regionalTempBias = 0;
  else if (globalSite.name.includes("Houston")) regionalTempBias = 2;

  return {
    id: `cluster_${profile.name}`,
    name: `Cluster ${profile.name}`,
    location: profile.location,
    workload: profile.workload,
    status: clusterStatus,
    time: now,
    // Aggregate stats for the whole cluster
    gpuLoad: avgGpu,
    cooling: avgCooling,
    temperature: 20 + avgGpu * 0.2 + regionalTempBias,
    powerUsage: totalPower,
    nodeCount: 8,
    activeNodes: nodes.filter(n => n.status === "online").length,
    // 🌐 Global data center info
    site: globalSite.name,
    dataCenter: dataCenterName,
    lat: globalSite.lat,
    lng: globalSite.lng,
    // Individual node data
    nodes,
    // ⚡ Include spike metadata
    spikeActive: isAffected && status === "spike"
  };
}

// 🧩 Generates telemetry for 8 main clusters (64 total GPU nodes)
export function generateTelemetry() {
  const clusters = [];
  for (let i = 0; i < 8; i++) {
    clusters.push(generateCluster(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'][i], i));
  }
  return clusters;
}

// 📊 Groups cluster telemetry by dataCenter region for analytics
export function groupByDataCenter(clusters) {
  const grouped = {};

  for (const cluster of clusters) {
    const center = cluster.dataCenter || "Unknown";
    if (!grouped[center]) {
      grouped[center] = {
        dataCenter: center,
        siteCount: 0,
        totalGpu: 0,
        totalCooling: 0,
        totalPower: 0,
        totalTemp: 0,
        onlineClusters: 0,
        offlineClusters: 0,
        spikeCount: 0,
      };
    }

    const g = grouped[center];
    g.siteCount++;
    g.totalGpu += cluster.gpuLoad;
    g.totalCooling += cluster.cooling;
    g.totalPower += cluster.powerUsage;
    g.totalTemp += cluster.temperature;
    if (cluster.spikeActive) g.spikeCount++;
    cluster.status === "online" ? g.onlineClusters++ : g.offlineClusters++;
  }

  // Compute averages for each data center
  const summaries = Object.values(grouped).map((g) => ({
    dataCenter: g.dataCenter,
    siteCount: g.siteCount,
    avgGpuLoad: Math.round(g.totalGpu / g.siteCount),
    avgCooling: Math.round(g.totalCooling / g.siteCount),
    avgPowerUsage: Math.round(g.totalPower / g.siteCount),
    avgTemperature: (g.totalTemp / g.siteCount).toFixed(1),
    onlineClusters: g.onlineClusters,
    offlineClusters: g.offlineClusters,
    activeSpikes: g.spikeCount,
  }));

  return summaries;
}
