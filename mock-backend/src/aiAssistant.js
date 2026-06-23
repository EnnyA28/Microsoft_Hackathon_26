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
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContentStream(prompt);

    let fullText = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
    }

    return fullText.trim();
  } catch (error) {
    console.error('Gemini API error:', error);
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
    console.log("🔇 Skipping ElevenLabs TTS — Assistant is muted.");
    return null;
  }
  
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Default: Bella

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_turbo_v2_5', // Fastest model
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    return Buffer.from(response.data);
  } catch (error) {
    console.error('ElevenLabs API error:', error.response?.data || error.message);
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
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContentStream(prompt);

    let fullText = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
    }

    return fullText.trim();
  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Error('Failed to generate AI response');
  }
}
