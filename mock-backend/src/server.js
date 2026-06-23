// src/server.js
import 'dotenv/config';
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { startTelemetry } from "./webSocket.js";
import simulateRouter from "./routes/simulate.js";
import optimizeRouter from "./routes/optimize.js";
import dashboardRouter from "./routes/dashboard.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use("/api/simulate-load-spike", simulateRouter);
app.use("/api/optimize", optimizeRouter);
app.use("/api/dashboard", dashboardRouter);


const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Check AI configuration
  if (process.env.GEMINI_API_KEY) {
    console.log('✅ AI Assistant: Gemini API configured');
  } else {
    console.log('⚠️  AI Assistant: Gemini API not configured (set GEMINI_API_KEY in .env)');
  }
  
  if (process.env.ELEVENLABS_API_KEY) {
    console.log('✅ AI Assistant: ElevenLabs TTS configured');
  } else {
    console.log('⚠️  AI Assistant: ElevenLabs TTS not configured (set ELEVENLABS_API_KEY in .env)');
  }
});

// Create **one** WebSocket server attached to the same port
const wss = new WebSocketServer({ server });

// Start the telemetry broadcaster once
startTelemetry(wss);
