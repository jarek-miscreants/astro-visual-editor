import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { filesRouter } from "./routes/files.js";
import { astRouter } from "./routes/ast.js";
import { mutationsRouter } from "./routes/mutations.js";
import { devServerRouter, startDevServerProxy, setupPreviewWebSocketProxy } from "./routes/dev-server.js";
import { componentsRouter } from "./routes/components.js";
import { configRouter } from "./routes/config.js";
import { contentRouter } from "./routes/content.js";
import { setupFileWatcher } from "./services/file-watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3011;
const PROJECT_PATH = process.env.TVE_PROJECT_PATH || process.argv[2] || "";

if (!PROJECT_PATH) {
  console.error(
    "Error: No project path specified.\nUsage: tve-server <path-to-astro-project>"
  );
  process.exit(1);
}

const resolvedProjectPath = path.resolve(PROJECT_PATH);
console.log(`[TVE Server] Project path: ${resolvedProjectPath}`);

// Middleware
app.use(cors());
app.use(express.json());

// Make project path available to routes
app.locals.projectPath = resolvedProjectPath;
app.locals.wss = wss;

// Serve injected script
app.use("/api/injected", express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api/files", filesRouter);
app.use("/api/ast", astRouter);
app.use("/api/mutations", mutationsRouter);
app.use("/api/dev-server", devServerRouter);
app.use("/api/components", componentsRouter);
app.use("/api/config", configRouter);
app.use("/api/content", contentRouter);

// Project info
app.get("/api/project/info", (_req, res) => {
  res.json({
    path: resolvedProjectPath,
    name: path.basename(resolvedProjectPath),
  });
});

// WebSocket connections
const wsClients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  console.log("[WS] Client connected");

  ws.on("close", () => {
    wsClients.delete(ws);
    console.log("[WS] Client disconnected");
  });
});

// Broadcast to all WebSocket clients
export function broadcast(message: object) {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Setup file watcher
setupFileWatcher(resolvedProjectPath, broadcast);

// Setup dev server proxy (HTTP + WebSocket for Vite HMR)
startDevServerProxy(app, resolvedProjectPath, broadcast);
setupPreviewWebSocketProxy(server);

server.listen(PORT, () => {
  console.log(`[TVE Server] Listening on http://localhost:${PORT}`);
});
