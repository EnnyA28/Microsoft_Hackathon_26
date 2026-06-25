// src/webSocket.js
import { generateTelemetry, setWorkloadSource, getWorkloadSource } from "./simulator.js";
import { getClusterState, simulateLoadSpike } from "./stateMachine.js";
import { appendLog } from "./utils/logger.js";
import { analyzeClusterData, textToSpeech, askQuestion } from "./aiAssistant.js";
import { muteAssistant, unmuteAssistant, getMuteState } from "./aiAssistant.js";


// 📊 Transform backend cluster data to frontend Cluster format
function transformClustersForFrontend(clusters) {
  return clusters.map((cluster) => {
    // Determine status based on GPU load and cooling efficiency
    let status = 'idle';
    
    // If cluster is offline, mark as idle
    if (cluster.status === 'offline') {
      status = 'idle';
    } else {
      const avgGpuLoad = cluster.gpuLoad;
      const avgCooling = cluster.cooling;
      
      // Calculate cooling efficiency (are we over-cooling or under-cooling?)
      const coolingEfficiency = avgCooling - avgGpuLoad; // Positive = over-cooling, Negative = under-cooling
      
      if (avgGpuLoad > 70) {
        // High load cluster
        status = 'active'; // Working hard on heavy tasks
      } else if (avgGpuLoad > 40) {
        // Medium load - check if AI needs to optimize
        if (Math.abs(coolingEfficiency) > 15) {
          // Cooling is out of sync with load (15%+ difference)
          status = 'optimizing'; // AI is adjusting cooling to match workload
        } else {
          status = 'active'; // Balanced and working normally
        }
      } else {
        // Low load
        if (avgCooling > avgGpuLoad + 20) {
          // Over-cooling idle cluster - waste of energy
          status = 'optimizing'; // AI reducing unnecessary cooling
        } else {
          status = 'idle'; // Low activity, appropriately cooled
        }
      }
    }
    
    return {
      name: cluster.name,
      status: status,
      gpu: cluster.gpuLoad,
      cooling: cluster.cooling,
      power: parseFloat(cluster.powerUsage.toFixed(2)),
      // 🌐 Geographic data
      site: cluster.site,
      dataCenter: cluster.dataCenter,
      lat: cluster.lat,
      lng: cluster.lng,
      spikeActive: cluster.spikeActive
    };
  });
}

// 📊 Generate nodes for GPU grid visualization (32 individual GPU nodes)
function generateNodes(clusters) {
  const allNodes = [];
  
  // Flatten all nodes from all clusters
  clusters.forEach(cluster => {
    cluster.nodes.forEach(node => {
      // Determine visual state based on GPU load
      let state = 'idle';
      
      // If node is offline, always mark as idle (gray)
      if (node.status === 'offline') {
        state = 'idle';
      } else {
        // Online nodes: determine by GPU load
        if (node.gpuLoad > 75) {
          state = 'hot';
        } else if (node.gpuLoad > 30) {
          state = 'active';
        } else {
          state = 'idle';
        }
      }
      
      allNodes.push({
        id: node.id,
        label: node.label, // e.g., "A1", "B5", etc.
        clusterName: node.clusterName,
        state: state,
        gpuLoad: node.gpuLoad,
        temperature: node.temperature.toFixed(1),
        cooling: node.cooling,  // Include cooling data
        powerUsage: node.powerUsage,  // Include power usage data
        status: node.status
      });
    });
  });
  
  return allNodes;
}

// 📊 Generate chart data for time series
let chartHistory = {
  labels: [],
  gpuData: [],
  coolingData: [],
  energyData: []
};

function updateChartData(clusters) {
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  // Keep last 20 data points
  if (chartHistory.labels.length > 20) {
    chartHistory.labels.shift();
    chartHistory.gpuData.shift();
    chartHistory.coolingData.shift();
    chartHistory.energyData.shift();
  }
  
  // Calculate averages across all nodes
  let totalGpu = 0;
  let totalCooling = 0;
  let totalNodes = 0;
  
  clusters.forEach(cluster => {
    cluster.nodes.forEach(node => {
      totalGpu += node.gpuLoad;
      totalCooling += node.cooling;
      totalNodes++;
    });
  });
  
  const avgGpu = totalNodes > 0 ? totalGpu / totalNodes : 0;
  const avgCooling = totalNodes > 0 ? totalCooling / totalNodes : 0;
  
  // Energy savings calculation (higher when GPU load is lower relative to cooling)
  const efficiencyRatio = avgCooling > 0 ? avgGpu / avgCooling : 1;
  const energySavings = 32 + (1 - efficiencyRatio) * 15; // 32-47% range
  
  chartHistory.labels.push(now);
  chartHistory.gpuData.push(avgGpu.toFixed(1));
  chartHistory.coolingData.push(avgCooling.toFixed(1));
  chartHistory.energyData.push(energySavings.toFixed(1));
  
  return {
    labels: [...chartHistory.labels],
    datasets: [
      { label: 'GPU Utilization %', data: [...chartHistory.gpuData] },
      { label: 'Cooling Power %', data: [...chartHistory.coolingData] },
      { label: 'Energy Savings %', data: [...chartHistory.energyData] }
    ]
  };
}

// 📊 Calculate stats for hero section
// Accumulate CO₂ savings over the session (resets on restart)
let cumulativeCO2Kg = 0;
let lastStatsTimestamp = Date.now();

function calculateStats(clusters) {
  const now = Date.now();
  const elapsedHours = (now - lastStatsTimestamp) / 3600000; // fraction of an hour since last tick
  lastStatsTimestamp = now;

  // IT power: sum of all node power (kW) — this is the real compute load
  const itPowerKW = clusters.reduce((sum, c) => sum + c.powerUsage, 0); // kW

  // Cooling power: each node's cooling is 0-100%, convert to kW
  // A typical GPU node cooling (fans, CRAC share) ≈ 0.8 kW at 100%
  const COOLING_KW_PER_NODE_MAX = 0.8;
  let aiCoolingKW = 0;
  let baselineCoolingKW = 0;
  let totalNodes = 0;

  clusters.forEach(cluster => {
    cluster.nodes.forEach(node => {
      if (node.status === "offline") return;
      totalNodes++;
      // AI-optimized cooling (what we're actually using)
      aiCoolingKW += (node.cooling / 100) * COOLING_KW_PER_NODE_MAX;
      // Baseline: traditional fixed-setpoint over-cools to 70-80% regardless of load
      const baselineCool = Math.max(70, node.gpuLoad + 20); // always at least 70%, or load+20%
      baselineCoolingKW += (baselineCool / 100) * COOLING_KW_PER_NODE_MAX;
    });
  });

  // Total power (IT + cooling) in MW
  const currentTotalMW = (itPowerKW + aiCoolingKW) / 1000;
  const baselineTotalMW = (itPowerKW + baselineCoolingKW) / 1000;

  // Energy savings %
  const energySavings = baselineTotalMW > 0
    ? ((baselineTotalMW - currentTotalMW) / baselineTotalMW) * 100
    : 0;

  // PUE = Total Facility Power / IT Power (realistic range: 1.1 - 1.6)
  const coolingPUE = itPowerKW > 0
    ? (itPowerKW + aiCoolingKW) / itPowerKW
    : 1.0;

  // CO₂ offset: accumulate over session lifetime
  // US grid average: ~0.39 kg CO₂ per kWh
  const CO2_KG_PER_KWH = 0.39;
  const powerSavedKW = (baselineCoolingKW - aiCoolingKW);
  const energySavedKWh = powerSavedKW * elapsedHours;
  cumulativeCO2Kg += energySavedKWh * CO2_KG_PER_KWH;

  // Project to full-day savings for display
  const dailySavingsKWh = powerSavedKW * 24;
  const dailyCO2Kg = Math.round(dailySavingsKWh * CO2_KG_PER_KWH);

  return {
    energySavings: energySavings,
    co2OffsetKg: dailyCO2Kg,           // projected daily CO₂ savings
    powerDrawMW: currentTotalMW,
    coolingPUE: coolingPUE
  };
}


export function startTelemetry(wss) {
  console.log("📡 WebSocket server started");

  wss.on("connection", (ws) => {
    console.log("✅ Client connected");

    // Send complete telemetry snapshot every 2 seconds
    const telemetryInterval = setInterval(() => {
      // Generate 6 clusters, each with 48 GPU nodes (288 total)
      const clusters = generateTelemetry();
      
      // Build complete payload matching frontend expectations
      const payload = {
        timestamp: Date.now(),
        stats: calculateStats(clusters),
        chart: updateChartData(clusters),
        clusters: transformClustersForFrontend(clusters), // 6 clusters
        nodes: generateNodes(clusters), // 288 individual GPU nodes
        workloadSource: getWorkloadSource() // "synthetic" or "azure"
      };
      
      ws.send(JSON.stringify({ 
        type: "telemetry", 
        payload 
      }));

      // Log telemetry (less verbose - only cluster summaries)
      const summary = {
        timestamp: payload.timestamp,
        clusterCount: clusters.length,
        totalNodes: clusters.reduce((sum, c) => sum + c.nodeCount, 0),
        activeNodes: clusters.reduce((sum, c) => sum + c.activeNodes, 0),
        avgGpuLoad: (clusters.reduce((sum, c) => sum + c.gpuLoad, 0) / clusters.length).toFixed(1),
        totalPowerMW: payload.stats.powerDrawMW
      };
      appendLog("telemetry", summary);
    }, 2000);

    // Handle incoming messages
    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);

        // 🟡 MUTE / UNMUTE CONTROL
        if (data.type === "mute") {
          muteAssistant();
          broadcastMuteState();
          return;
        }

        if (data.type === "unmute") {
          unmuteAssistant();
          broadcastMuteState();
          return;
        }

        if (data.type === "get-mute-state") {
          ws.send(JSON.stringify({ type: "mute-state", muted: getMuteState() }));
          return;
        }

        // 🔄 Workload source toggle (synthetic vs azure)
        if (data.type === "set-workload-source") {
          setWorkloadSource(data.source);
          // Broadcast the new source to all clients
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: "workload-source", source: getWorkloadSource() }));
            }
          });
          return;
        }

        if (data.type === "get-workload-source") {
          ws.send(JSON.stringify({ type: "workload-source", source: getWorkloadSource() }));
          return;
        }

        
        if (data.type === "ping") {
          ws.send(
            JSON.stringify({ type: "pong", time: new Date().toISOString() })
          );
        } 
        else if (data.type === "ask_ai") {
          // Get current telemetry
          const clusters = generateTelemetry();
          const payload = {
            timestamp: Date.now(),
            stats: calculateStats(clusters),
            clusters: transformClustersForFrontend(clusters),
            nodes: generateNodes(clusters)
          };
          
          try {
            // Generate AI analysis
            const analysis = await analyzeClusterData(payload);
            
            // Optionally convert to speech (if TTS is enabled)
            let audioBase64 = null;
            if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION && data.withAudio) {
              const audioBuffer = await textToSpeech(analysis);
              if (audioBuffer) audioBase64 = audioBuffer.toString('base64');
            }
            
            ws.send(JSON.stringify({
              type: "ai_response",
              text: analysis,
              audio: audioBase64,
              timestamp: Date.now()
            }));
            
            console.log("🤖 AI analysis sent");
          } catch (error) {
            ws.send(JSON.stringify({
              type: "ai_error",
              error: error.message
            }));
            console.error("AI assistant error:", error);
          }
        }
        else if (data.type === "ask_question") {
          // User asking a specific question
          const clusters = generateTelemetry();
          const payload = {
            stats: calculateStats(clusters),
            clusters: transformClustersForFrontend(clusters)
          };
          
          try {
            const answer = await askQuestion(data.question, payload);
            
            let audioBase64 = null;
            if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION && data.withAudio) {
              const audioBuffer = await textToSpeech(answer);
              if (audioBuffer) audioBase64 = audioBuffer.toString('base64');
            }
            
            ws.send(JSON.stringify({
              type: "ai_answer",
              question: data.question,
              answer: answer,
              audio: audioBase64,
              timestamp: Date.now()
            }));
          } catch (error) {
            ws.send(JSON.stringify({
              type: "ai_error",
              error: error.message
            }));
          }
        }
      } catch (e) {
        console.error("Error parsing message:", e);
      }
    });

    ws.on("close", () => {
      console.log("❌ Client disconnected");
      clearInterval(telemetryInterval);
    });
    
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
}
function broadcastMuteState() {
  const stateMsg = JSON.stringify({ type: "mute-state", muted: getMuteState() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(stateMsg);
  });
}

