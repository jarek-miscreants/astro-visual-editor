import type { ServerWsMessage } from "@tve/shared";

type WsHandler = (message: ServerWsMessage) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<WsHandler>();

export function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    console.log("[WS] Connected");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerWsMessage;
      for (const handler of handlers) {
        handler(message);
      }
    } catch {
      // ignore invalid messages
    }
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected, reconnecting in 2s...");
    ws = null;
    reconnectTimer = setTimeout(connectWebSocket, 2000);
  };
}

export function onWsMessage(handler: WsHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
