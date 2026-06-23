import express from "express";
import { generateTelemetry } from "../simulator.js";
const router = express.Router();

router.get("/", (req, res) => {
  const clusters = generateTelemetry(32);

  // 1. Current power draw
  const currentPowerDraw =
    clusters.reduce((sum, c) => sum + c.powerUsage, 0) / 1000;

  // 2. Cooling efficiency (PUE)
  const totalPower = clusters.reduce(
    (sum, c) => sum + c.powerUsage + c.cooling,
    0
  );
  const itPower = clusters.reduce((sum, c) => sum + c.powerUsage, 0);
  const PUE = (totalPower / itPower).toFixed(2);

  // 3. Energy savings
  const baselinePower = 2.77; // MW, your defined baseline
  const energySavings = (
    ((baselinePower - currentPowerDraw) / baselinePower) *
    100
  ).toFixed(1);
  const lastHourChange = (Math.random() * 5).toFixed(1); // simulate trend

  // 4. CO2 offset
  const CO2_PER_MW_HOUR = 278;
  const co2Offset = (currentPowerDraw * CO2_PER_MW_HOUR).toFixed(0);
  const treesEquivalent = Math.round(co2Offset / 22);

  res.json({
    energy: { percent: energySavings, change: lastHourChange },
    co2: { kg: co2Offset, trees: treesEquivalent },
    power: { current: currentPowerDraw.toFixed(2), target: 1.94 },
    cooling: { pue: PUE, optimized: (Math.random() * 0.2).toFixed(2) },
  });
});

export default router;
