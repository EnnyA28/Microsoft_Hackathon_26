import express from "express";
import { simulateLoadSpike } from "../stateMachine.js";

const router = express.Router();

router.get("/", (req, res) => {
  simulateLoadSpike();
  res.json({ message: "Triggered load spike for 10 seconds." });
});

export default router;
