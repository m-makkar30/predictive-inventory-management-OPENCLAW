import { useEffect, useRef, useCallback, useState } from 'react';

export function useWebSocket(url) {
  const wsRef = useRef(null);
  const listenersRef = useRef({});
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected');
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[WS] Disconnected, reconnecting...');
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const { event: eventName, data } = JSON.parse(event.data);
        const handlers = listenersRef.current[eventName];
        if (handlers) {
          handlers.forEach(fn => fn(data));
        }
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };
  }, [url]);

  const on = useCallback((event, handler) => {
    if (!listenersRef.current[event]) {
      listenersRef.current[event] = [];
    }
    listenersRef.current[event].push(handler);

    return () => {
      listenersRef.current[event] = listenersRef.current[event].filter(h => h !== handler);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, on };
}
