// src/webSocket.js
import { generateTelemetry } from "./simulator.js";
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
function calculateStats(clusters) {
  // Sum up power from all clusters
  const currentPowerDraw = clusters.reduce((sum, c) => sum + c.powerUsage, 0) / 1000; // Convert to MW
  const baselinePower = 2.77; // MW baseline
  const energySavings = ((baselinePower - currentPowerDraw) / baselinePower) * 100;
  
  // Calculate PUE (Power Usage Effectiveness)
  const totalPower = clusters.reduce((sum, c) => sum + c.powerUsage + c.cooling, 0);
  const itPower = clusters.reduce((sum, c) => sum + c.powerUsage, 0);
  const coolingPUE = itPower > 0 ? totalPower / itPower : 1.0;
  
  // CO2 offset calculation
  const CO2_PER_MW_HOUR = 278; // kg CO2 per MW-hour
  const co2OffsetKg = Math.round(currentPowerDraw * CO2_PER_MW_HOUR);
  
  return {
    energySavings: energySavings,
    co2OffsetKg: co2OffsetKg,
    powerDrawMW: currentPowerDraw,
    coolingPUE: coolingPUE
  };
}


export function startTelemetry(wss) {
  console.log("📡 WebSocket server started");

  wss.on("connection", (ws) => {
    console.log("✅ Client connected");

    // Send complete telemetry snapshot every 2 seconds
    const telemetryInterval = setInterval(() => {
      // Generate 4 clusters, each with 8 GPU nodes (32 total)
      const clusters = generateTelemetry();
      
      // Build complete payload matching frontend expectations
      const payload = {
        timestamp: Date.now(),
        stats: calculateStats(clusters),
        chart: updateChartData(clusters),
        clusters: transformClustersForFrontend(clusters), // 4 clusters
        nodes: generateNodes(clusters) // 32 individual GPU nodes
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
            if (process.env.ELEVENLABS_API_KEY && data.withAudio) {
              const audioBuffer = await textToSpeech(analysis);
              audioBase64 = audioBuffer.toString('base64');
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
            if (process.env.ELEVENLABS_API_KEY && data.withAudio) {
              const audioBuffer = await textToSpeech(answer);
              audioBase64 = audioBuffer.toString('base64');
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

