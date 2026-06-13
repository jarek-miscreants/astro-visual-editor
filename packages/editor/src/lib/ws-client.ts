import type { ServerWsMessage } from "@tve/shared";

type WsHandler = (message: ServerWsMessage) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<WsHandler>();

export function connectWebSocket() {
  // CONNECTING counts too — a second call while the handshake is in flight
  // (StrictMode double-invoke, project switch) must not open a parallel
  // socket that keeps feeding the shared handler set.
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws = socket;

  socket.onopen = () => {
    console.log("[WS] Connected");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerWsMessage;
      for (const handler of handlers) {
        handler(message);
      }
    } catch {
      // ignore invalid messages
    }
  };

  socket.onclose = () => {
    // A superseded socket closing must not null out (or reconnect over)
    // the currently active one.
    if (ws !== socket) return;
    console.log("[WS] Disconnected, reconnecting in 2s...");
    ws = null;
    reconnectTimer = setTimeout(connectWebSocket, 2000);
  };
}

export function onWsMessage(handler: WsHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
