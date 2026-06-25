let isMuted = false; // 🔇 global mute state

export function muteAssistant() {
  isMuted = true;
  console.log("🔇 AI Assistant muted");
}

export function unmuteAssistant() {
  isMuted = false;
  console.log("🔊 AI Assistant unmuted");
}

export function getMuteState() {
  return isMuted;
}

// backend/src/aiAssistant.js
import { AzureOpenAI } from 'openai';
import sdk from 'microsoft-cognitiveservices-speech-sdk';

// --- Azure OpenAI (LLM) ---
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';

export function isLLMConfigured() {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}

export function isTTSConfigured() {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

let _openaiClient = null;
function getOpenAIClient() {
  if (!isLLMConfigured()) {
    throw new Error('Azure OpenAI not configured (set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY)');
  }
  if (!_openaiClient) {
    _openaiClient = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-10-21',
      deployment: AZURE_OPENAI_DEPLOYMENT,
    });
  }
  return _openaiClient;
}

/**
 * Run a chat completion against Azure OpenAI and return trimmed text.
 * @param {string} prompt
 * @param {string} systemPrompt
 * @returns {Promise<string>}
 */
async function generateText(prompt, systemPrompt = null) {
  const client = getOpenAIClient();
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  const result = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    messages,
    max_tokens: 400,
    temperature: 0.6,
  });
  return (result.choices[0]?.message?.content || '').trim();
}

const SYSTEM_PROMPT = `You are ArcticFlow AI, an expert datacenter cooling optimization assistant built for Microsoft Azure infrastructure.

Your role:
- Analyze real-time GPU cluster telemetry (utilization, temperatures, cooling %, power draw)
- Provide actionable recommendations to reduce energy waste and CO₂ emissions
- Explain the physics: COP (Coefficient of Performance), PUE, thermal dynamics
- Quantify savings in kWh, dollars, and CO₂ tonnes when possible

Personality: Technical but concise. Data-driven. Environment-first mindset. Reference specific clusters and numbers from the live data. Never generic — always grounded in what's happening NOW.

Format: Use short paragraphs. Bold key metrics. Keep responses under 150 words unless asked for detail.`;

/**
 * Analyze cluster telemetry data and provide insights
 * @param {Object} telemetrySnapshot - Current telemetry data
 * @returns {Promise<string>} - AI-generated analysis
 */
export async function analyzeClusterData(telemetrySnapshot) {
  const { clusters, stats, nodes } = telemetrySnapshot;
  
  // Find hottest and coldest clusters
  const sortedByGpu = [...clusters].sort((a, b) => b.gpu - a.gpu);
  const hottest = sortedByGpu[0];
  const coldest = sortedByGpu[sortedByGpu.length - 1];
  
  // Node-level insights
  const allNodes = nodes || [];
  const onlineNodes = allNodes.filter(n => n.status !== 'offline');
  const hotNodes = onlineNodes.filter(n => parseFloat(String(n.temperature)) > 28);
  const overCooled = onlineNodes.filter(n => n.cooling > n.gpuLoad + 20);

  const prompt = `Analyze this REAL-TIME ArcticFlow datacenter telemetry and provide insights:

CLUSTER STATUS (6 clusters × 48 nodes each = 288 GPUs):
${clusters.map(c => `• ${c.name}: GPU ${c.gpu}% | Cooling ${c.cooling}% | Power ${c.power}kW | Status: ${c.status} | ${c.cooling - c.gpu > 15 ? '⚠️ Over-cooled by ' + (c.cooling - c.gpu) + '%' : '✓ Balanced'}`).join('\n')}

HOTTEST CLUSTER: ${hottest?.name} at ${hottest?.gpu}% GPU
COLDEST CLUSTER: ${coldest?.name} at ${coldest?.gpu}% GPU
HOT NODES (>28°C): ${hotNodes.length} of ${onlineNodes.length} online
OVER-COOLED NODES (cooling > load+20%): ${overCooled.length}

FACILITY METRICS:
• Energy Savings vs Baseline: ${stats.energySavings.toFixed(1)}%
• Total Power Draw: ${stats.powerDrawMW.toFixed(3)} MW (IT + cooling)
• Cooling PUE: ${stats.coolingPUE.toFixed(3)}
• CO₂ Saved Today: ${stats.co2OffsetKg} kg

TASKS:
1. What's the most important thing happening right now? (1-2 sentences)
2. Identify the biggest efficiency opportunity
3. One specific recommendation with estimated impact`;

  try {
    return await generateText(prompt, SYSTEM_PROMPT);
  } catch (error) {
    console.error('Azure OpenAI error:', error);
    throw new Error('Failed to generate AI analysis');
  }
}

/**
 * Convert AI text response to speech using ElevenLabs
 * @param {string} text - Text to convert to speech
 * @returns {Promise<Buffer>} - Audio buffer
 */
export async function textToSpeech(text) {
  if (isMuted) {
    console.log("🔇 Skipping Azure TTS — Assistant is muted.");
    return null;
  }

  if (!isTTSConfigured()) {
    throw new Error('Azure Speech not configured (set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION)');
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
  );
  speechConfig.speechSynthesisVoiceName = process.env.AZURE_SPEECH_VOICE || 'en-US-AvaNeural';
  // MP3 keeps the payload small for sending over the websocket as base64.
  speechConfig.speechSynthesisOutputFormat =
    sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

  try {
    return await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text,
        (result) => {
          synthesizer.close();
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve(Buffer.from(result.audioData));
          } else {
            reject(new Error(result.errorDetails || 'Speech synthesis failed'));
          }
        },
        (error) => {
          synthesizer.close();
          reject(error);
        }
      );
    });
  } catch (error) {
    console.error('Azure Speech error:', error.message || error);
    throw new Error('Failed to generate speech');
  }
}

/**
 * Ask AI a specific question about the data center
 * @param {string} question - User's question
 * @param {Object} telemetrySnapshot - Current telemetry context
 * @returns {Promise<string>} - AI response
 */
export async function askQuestion(question, telemetrySnapshot) {
  const { clusters, stats, nodes } = telemetrySnapshot;

  const allNodes = nodes || [];
  const onlineNodes = allNodes.filter(n => n.status !== 'offline');
  const temps = onlineNodes.map(n => parseFloat(String(n.temperature)) || 0);
  const maxTemp = temps.length > 0 ? Math.max(...temps).toFixed(1) : 'N/A';
  const avgTemp = temps.length > 0 ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : 'N/A';

  const prompt = `Answer this question using CURRENT real-time datacenter data:

QUESTION: "${question}"

LIVE STATE (288 GPU nodes across 6 clusters):
${clusters.map(c => `• ${c.name}: ${c.gpu}% GPU, ${c.cooling}% cooling, ${c.power}kW, status: ${c.status}`).join('\n')}

FACILITY:
• Total Power: ${stats.powerDrawMW.toFixed(3)} MW
• Energy Savings vs Baseline: ${stats.energySavings.toFixed(1)}%
• PUE: ${stats.coolingPUE.toFixed(3)}
• CO₂ Saved/Day: ${stats.co2OffsetKg} kg
• Avg Temperature: ${avgTemp}°C | Max: ${maxTemp}°C
• Online Nodes: ${onlineNodes.length}/${allNodes.length}

Be specific — reference actual cluster names and numbers. If the question relates to optimization, quantify the potential savings.`;

  try {
    return await generateText(prompt, SYSTEM_PROMPT);
  } catch (error) {
    console.error('Azure OpenAI error:', error);
    throw new Error('Failed to generate AI response');
  }
}
