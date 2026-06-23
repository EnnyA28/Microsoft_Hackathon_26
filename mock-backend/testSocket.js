// backend/testSocket.js
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");

ws.on("open", () => {
  console.log("✅ Connected to WebSocket server");
  ws.send(JSON.stringify({ type: "ping" }));
});

ws.on("message", (msg) => {
  const payload = JSON.parse(msg);

  if (payload.type === "telemetry") {
    console.log(`📊 Received ${payload.data.length} clusters`);

    // Show IDs of all clusters
    const ids = payload.data.map((c) => c.id).join(", ");
    console.log("🧩 Cluster IDs:", ids);

    // Optional: show first 2 examples
    console.log("   Example 1:", payload.data[0]);
    console.log("   Example 2:", payload.data[1]);
  } else {
    console.log("📥 Message:", payload);
  }
});
