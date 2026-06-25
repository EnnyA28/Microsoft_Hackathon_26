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
 * @returns {Promise<string>}
 */
async function generateText(prompt) {
  const client = getOpenAIClient();
  const result = await client.chat.completions.create({
    model: AZURE_OPENAI_DEPLOYMENT,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0.7,
  });
  return (result.choices[0]?.message?.content || '').trim();
}

/**
 * Analyze cluster telemetry data and provide insights
 * @param {Object} telemetrySnapshot - Current telemetry data
 * @returns {Promise<string>} - AI-generated analysis
 */
export async function analyzeClusterData(telemetrySnapshot) {
  const { clusters, stats } = telemetrySnapshot;
  
  // Build context-rich prompt with ACTUAL data
  const prompt = `You are ThermaMind AI, an expert data center optimization assistant. Analyze this REAL-TIME telemetry data and provide actionable insights.

CURRENT CLUSTER STATUS:
${clusters.map(c => `
- ${c.name}: ${c.status.toUpperCase()}
  • GPU Load: ${c.gpu}%
  • Cooling: ${c.cooling}%
  • Power: ${c.power}kW
  • Efficiency: ${c.cooling - c.gpu > 15 ? '⚠️ OVER-COOLED by ' + (c.cooling - c.gpu) + '%' : c.gpu - c.cooling > 15 ? '⚠️ UNDER-COOLED by ' + (c.gpu - c.cooling) + '%' : '✓ Well matched'}
`).join('')}

OVERALL METRICS:
• Energy Savings: ${stats.energySavings.toFixed(1)}% vs traditional cooling
• Power Draw: ${stats.powerDrawMW.toFixed(2)} MW across 32 GPU nodes
• Cooling Efficiency (PUE): ${stats.coolingPUE.toFixed(2)} (lower is better, ideal is 1.0)
• CO₂ Offset: ${stats.co2OffsetKg} kg today

YOUR TASK:
1. Summarize current data center status in 2-3 sentences
2. Identify the MOST CRITICAL efficiency issue (if any)
3. Provide ONE specific, actionable recommendation with estimated energy/cost savings

Keep response under 150 words. Be technical but clear. Focus on what matters most RIGHT NOW.`;

  try {
    return await generateText(prompt);
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
  const { clusters, stats } = telemetrySnapshot;

  const prompt = `You are ThermaMind AI, an expert data center optimization assistant. Answer this question using the CURRENT real-time data:

QUESTION: "${question}"

CURRENT STATE:
${clusters.map(c => `• ${c.name}: ${c.gpu}% GPU, ${c.cooling}% cooling, ${c.power}kW, ${c.status}`).join('\n')}
• Total Power: ${stats.powerDrawMW.toFixed(2)} MW
• Energy Savings: ${stats.energySavings.toFixed(1)}%
• PUE: ${stats.coolingPUE.toFixed(2)}

Answer in 2-3 sentences. Be specific and reference actual cluster data. If the question can't be answered with current data, say so.`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error('Azure OpenAI error:', error);
    throw new Error('Failed to generate AI response');
  }
}
