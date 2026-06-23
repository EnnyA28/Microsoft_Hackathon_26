import { useEffect, useState, useRef } from 'react';

type TelemetryStats = {
  energySavings: number;
  co2OffsetKg: number;
  powerDrawMW: number;
  coolingPUE: number;
  outsideAirC?: number;
  pueInBand?: boolean;
};

type ChartDataset = {
  label: string;
  data: number[];
};

type ChartData = {
  labels: string[];
  datasets: ChartDataset[];
};

type Cluster = {
  name: string;
  status: 'active' | 'idle' | 'optimizing';
  gpu: number;
  cooling: number;
  power: number;
};

type Node = {
  id: number;
  label: string;
  clusterName: string;
  state: 'active' | 'hot' | 'idle';
  gpuLoad: number;
  temperature: string;
  cooling: number;
  powerUsage: number;
  status: string;
};

type TelemetrySnapshot = {
  timestamp: number;
  stats: TelemetryStats;
  chart: ChartData;
  clusters: Cluster[];
  nodes: Node[];
};

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useTelemetry(wsUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    let isCleanedUp = false;
    
    const connect = () => {
      if (isCleanedUp) return; // Don't connect if already cleaned up
      
      try {
        setStatus('connecting');
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isCleanedUp) {
            ws.close();
            return;
          }
          console.log('WebSocket connected');
          setStatus('connected');
          reconnectAttempts.current = 0;
        };

        ws.onmessage = (event) => {
          if (isCleanedUp) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'telemetry' && message.payload) {
              setTelemetry(message.payload);
            }
          } catch (e) {
            console.error('Failed to parse telemetry message', e);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error', error);
          setStatus('error');
        };

        ws.onclose = () => {
          if (isCleanedUp) return;
          console.log('WebSocket disconnected');
          setStatus('disconnected');
          wsRef.current = null;

          // Exponential backoff reconnection
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current += 1;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
          
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, delay);
        };
      } catch (e) {
        console.error('Failed to create WebSocket', e);
        setStatus('error');
      }
    };

    connect();

    return () => {
      isCleanedUp = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl]);

  // Return the ref object so consumers can always access the current WebSocket instance
  return { telemetry, status, wsRef };
}
