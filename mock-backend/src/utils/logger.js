// src/utils/logger.js
import fs from "fs";
import path from "path";

const LOG_PATH = path.resolve("data_logs");

// Ensure the logs directory exists
if (!fs.existsSync(LOG_PATH)) {
  fs.mkdirSync(LOG_PATH, { recursive: true });
}

const TELEMETRY_LOG = path.join(LOG_PATH, "telemetry_log.jsonl");

export function appendLog(type, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type,
    data,
  };

  fs.appendFile(TELEMETRY_LOG, JSON.stringify(logEntry) + "\n", (err) => {
    if (err) console.error("❌ Failed to write log:", err);
  });
}
