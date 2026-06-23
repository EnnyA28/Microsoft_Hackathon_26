// ⚡ Simulates dynamic load spikes for specific regions or globally

let currentState = {
  status: "normal",        // "normal" | "spike"
  loadMultiplier: 1.0,     // 1.0 = normal, 1.5 = 50% spike, 2.0 = 100% spike
  region: "global",        // "global" | "houston" | "london" | "norway" | "calgary"
  duration: 0,             // seconds remaining in current spike
};

// Spike configurations
const spikeProfiles = [
  { region: "global", multiplier: 1.5, duration: 30 },
  { region: "houston", multiplier: 1.8, duration: 20 },
  { region: "london", multiplier: 1.4, duration: 25 },
  { region: "norway", multiplier: 1.6, duration: 15 },
  { region: "calgary", multiplier: 1.7, duration: 18 },
];

// Trigger a random spike every 2-5 minutes
let nextSpikeIn = Math.random() * 180 + 120; // 120-300 seconds
let tickCounter = 0;

export function getClusterState() {
  return { ...currentState };
}

export function updateStateMachine() {
  tickCounter++;

  // If currently in a spike, count down
  if (currentState.status === "spike") {
    currentState.duration--;
    if (currentState.duration <= 0) {
      // Spike ended - return to normal
      currentState.status = "normal";
      currentState.loadMultiplier = 1.0;
      currentState.region = "global";
      console.log("⚡ Spike ended - returning to normal load");
      
      // Schedule next spike
      nextSpikeIn = Math.random() * 180 + 120;
    }
    return;
  }

  // Check if it's time for a new spike
  nextSpikeIn--;
  if (nextSpikeIn <= 0) {
    // Trigger a random spike
    const spike = spikeProfiles[Math.floor(Math.random() * spikeProfiles.length)];
    currentState.status = "spike";
    currentState.loadMultiplier = spike.multiplier;
    currentState.region = spike.region;
    currentState.duration = spike.duration;
    
    console.log(`⚡ SPIKE TRIGGERED: ${spike.region.toUpperCase()} - ${spike.multiplier}x load for ${spike.duration}s`);
  }
}

// Legacy function for backward compatibility
export function simulateLoadSpike() {
  currentState.loadMultiplier = 1.5;
  currentState.status = "spike";
  currentState.region = "global";
  currentState.duration = 10;
}

// Update state machine every 2 seconds
setInterval(updateStateMachine, 2000);
