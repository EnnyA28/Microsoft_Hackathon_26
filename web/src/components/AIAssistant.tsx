// frontend/src/components/AIAssistant.tsx
import { useState, useRef, useEffect } from 'react';

type AIAssistantProps = {
  wsRef: import('react').RefObject<WebSocket | null>;
  connectionStatus: string;
};

export function AIAssistant({ wsRef, connectionStatus }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [response, setResponse] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [question, setQuestion] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // Re-run this effect when the connection status changes so we always attach to the current socket
    const ws = wsRef?.current;
    if (!ws) return;

    let onOpen: ((ev: Event) => void) | null = null;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'ai_response' || msg.type === 'ai_answer') {
          setResponse(msg.text || msg.answer);
          setIsAnalyzing(false);

          // Play audio only if not muted
          if (msg.audio && audioRef.current && !isMuted) {
            const audioBlob = base64ToBlob(msg.audio, 'audio/mpeg');
            const audioUrl = URL.createObjectURL(audioBlob);
            audioRef.current.src = audioUrl;
            audioRef.current.play();
            setIsPlaying(true);
          }
        }

        if (msg.type === 'ai_error') {
          setResponse('\u274c Error: ' + msg.error);
          setIsAnalyzing(false);
          setIsPlaying(false);
        }

        // handle mute state from backend
        if (msg.type === 'mute-state') {
          setIsMuted(msg.muted);
        }
      } catch (e) {
        console.error('Failed to parse AI message:', e);
      }
    };

    ws.addEventListener('message', handleMessage);

    // Request initial mute state when connected
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get-mute-state' }));
      }
    } catch (e) {
      console.error('Failed to request mute state', e);
    }

    return () => {
      ws.removeEventListener('message', handleMessage);
      if (onOpen) ws.removeEventListener('open', onOpen as EventListener);
    };
  }, [connectionStatus, wsRef, isMuted]);

  // Pause audio if muted changes while audio is playing
  useEffect(() => {
    if (isMuted && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, [isMuted]);

  const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  const analyzeNow = () => {
    const ws = wsRef?.current;
    if (!ws || connectionStatus !== 'connected') return;

    setIsAnalyzing(true);
    setResponse('');
    try {
      ws.send(JSON.stringify({ 
        type: 'ask_ai',
        withAudio: true // Enable TTS
      }));
    } catch (e) {
      console.error('Failed to send ask_ai:', e);
      setIsAnalyzing(false);
    }
  };

  const askAI = () => {
    const ws = wsRef?.current;
    if (!ws || connectionStatus !== 'connected' || !question.trim()) return;

    setIsAnalyzing(true);
    setResponse('');
    try {
      ws.send(JSON.stringify({ 
        type: 'ask_question',
        question: question.trim(),
        withAudio: true
      }));
    } catch (e) {
      console.error('Failed to send ask_question:', e);
      setIsAnalyzing(false);
    }
    setQuestion('');
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={connectionStatus !== 'connected'}
        className={`fixed bottom-6 right-6 w-16 h-16 rounded-full shadow-lg transition-all duration-300 ${
          isOpen 
            ? 'bg-slate-800 border-2 border-cyan-400' 
            : 'bg-gradient-to-br from-cyan-400 to-emerald-400 hover:scale-110'
        } ${connectionStatus !== 'connected' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        aria-label="Toggle AI Assistant"
      >
        {isOpen ? (
          <span className="text-2xl">✕</span>
        ) : (
          <div className="flex flex-col items-center justify-center">
            <span className="text-2xl">🤖</span>
            {isPlaying && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 tm-pulse mt-1" />}
          </div>
        )}
      </button>

      {/* Expanded Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-96 tm-glass border border-cyan-400/30 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-cyan-400/30 bg-gradient-to-r from-cyan-500/10 to-emerald-500/10">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧠</span>
              <div className="flex-1">
                <div className="font-semibold">ThermaMind AI Assistant</div>
                <div className="text-xs text-slate-400">Powered by Gemini + ElevenLabs</div>
              </div>
              {isPlaying && (
                <div className="tm-badge tm-badge-green text-xs">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 tm-pulse" />
                  Speaking
                </div>
              )}
              <button
                onClick={() => {
                  try {
                    // Optimistically update UI immediately
                    const willUnmute = isMuted;
                    setIsMuted(!isMuted);

                    // Stop audio locally when muting
                    if (!willUnmute && audioRef.current) {
                      audioRef.current.pause();
                      audioRef.current.currentTime = 0;
                      setIsPlaying(false);
                    }

                    const ws = wsRef?.current;
                    if (!ws) {
                      console.warn('Cannot mute/unmute: WebSocket not available');
                      return;
                    }

                    if (ws.readyState !== WebSocket.OPEN) {
                      console.warn('Cannot mute/unmute: WebSocket not open (state=' + ws.readyState + ')');
                      return;
                    }

                    ws.send(JSON.stringify({ type: willUnmute ? 'unmute' : 'mute' }));
                  } catch (e) {
                    console.error('Failed to send mute/unmute:', e);
                  }
                }}
                className={`ml-2 px-2 py-1 rounded text-xs font-semibold border transition
                  ${isMuted
                    ? 'border-red-400 text-red-400 hover:bg-red-400/10'
                    : 'border-cyan-400 text-cyan-400 hover:bg-cyan-400/10'
                  }`}
              >
                {isMuted ? '🔇 Unmute' : '🔊 Mute'}
              </button>
            </div>
          </div>


          <div className="p-4 max-h-[400px] overflow-y-auto">
            {/* Muted banner */}
            {isMuted && (
              <div className="mb-3 p-3 rounded bg-red-700/20 border border-red-600/30 flex items-center gap-3">
                <div className="text-2xl">🎙️�</div>
                <div className="flex-1 text-sm text-red-100">Assistant is muted — audio disabled. Click Unmute to enable voice responses.</div>
                <button
                  onClick={() => {
                    try {
                      const ws = wsRef?.current;
                      if (!ws || ws.readyState !== WebSocket.OPEN) {
                        console.warn('Cannot unmute: socket not open');
                        return;
                      }
                      ws.send(JSON.stringify({ type: 'unmute' }));
                      // stop any current audio playback
                      if (audioRef.current) {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                      }
                      // Optimistically update UI
                      setIsMuted(false);
                    } catch (e) {
                      console.error('Failed to send unmute', e);
                    }
                  }}
                  className="px-3 py-1 rounded bg-red-600/40 text-sm font-semibold hover:bg-red-600/60"
                >
                  Unmute
                </button>
              </div>
            )}
            {/* Quick Analysis Button */}
            <button
              onClick={analyzeNow}
              disabled={isAnalyzing}
              className="w-full px-4 py-3 mb-4 rounded-lg font-semibold bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-900 disabled:opacity-50 hover:shadow-lg transition"
            >
              {isAnalyzing ? '🔄 Analyzing...' : '📊 Analyze Current Status'}
            </button>

            {/* Response Display */}
            {response && (
              <div className="mb-4 p-4 bg-slate-900/50 rounded-lg border border-cyan-400/20">
                <div className="text-sm leading-relaxed whitespace-pre-line">{response}</div>
              </div>
            )}

            {/* Ask Question */}
            <div className="mt-4 pt-4 border-t border-cyan-400/20">
              <div className="text-xs font-semibold text-slate-400 mb-2">Ask a Question</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && askAI()}
                  placeholder="e.g., Why is power high?"
                  disabled={isAnalyzing}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900/50 border border-cyan-400/30 text-sm focus:outline-none focus:border-cyan-400"
                />
                <button
                  onClick={askAI}
                  disabled={isAnalyzing || !question.trim()}
                  className="px-4 py-2 rounded-lg bg-cyan-400/20 text-cyan-400 hover:bg-cyan-400/30 disabled:opacity-50 transition"
                >
                  Ask
                </button>
              </div>
            </div>

            {/* Example Questions */}
            <div className="mt-3 space-y-1">
              <div className="text-xs text-slate-500 mb-1">Quick questions:</div>
              {[
                'Which cluster should I run my next job on?',
                'Why is my power consumption high?',
                'Are there any efficiency issues?'
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => setQuestion(q)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition"
                >
                  💬 {q}
                </button>
              ))}
            </div>
          </div>

          {/* Audio Player (hidden) */}
          <audio 
            ref={audioRef}
            onEnded={() => setIsPlaying(false)}
            onError={() => setIsPlaying(false)}
          />
        </div>
      )}
    </>
  );
}
