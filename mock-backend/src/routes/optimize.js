import express from "express";

const router = express.Router();

router.post("/", (req, res) => {
  const { gpuLoad, cooling } = req.body;

  let recommendation = "No optimization needed.";
  if (cooling > gpuLoad + 10)
    recommendation = "Reduce cooling power — overcooled.";
  else if (gpuLoad > 90)
    recommendation = "High GPU load detected — scale resources.";
  else if (gpuLoad < 50 && cooling > 50)
    recommendation = "Lower cooling and idle GPUs.";

  res.json({
    action: recommendation,
    savingsEstimate: Math.round(Math.random() * 20),
    timestamp: new Date().toISOString(),
  });
});

export default router;
