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
import { pagesRouter } from "./routes/pages.js";
import { configRouter } from "./routes/config.js";
import { contentRouter } from "./routes/content.js";
import { projectRouter } from "./routes/project.js";
import { gitRouter } from "./routes/git.js";
import { setupFileWatcher } from "./services/file-watcher.js";
import { stopDevServer } from "./services/astro-dev-server.js";
import type { FSWatcher } from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3011;
const INITIAL_PROJECT_PATH = process.env.TVE_PROJECT_PATH || process.argv[2] || "";

const resolvedInitialPath = INITIAL_PROJECT_PATH
  ? path.resolve(INITIAL_PROJECT_PATH)
  : null;

if (resolvedInitialPath) {
  console.log(`[TVE Server] Project path: ${resolvedInitialPath}`);
} else {
  console.log(`[TVE Server] No project path — open one from the editor UI`);
}

// Middleware
app.use(cors());
app.use(express.json());

// Mutable project path + file watcher handle. Stored on app.locals so routes
// can read the current project path, and switched at runtime via project/switch.
app.locals.projectPath = resolvedInitialPath;
app.locals.wss = wss;

let fileWatcher: FSWatcher | null = null;

async function attachWatcher(projectPath: string | null) {
  if (fileWatcher) {
    await fileWatcher.close();
    fileWatcher = null;
  }
  if (projectPath) {
    fileWatcher = setupFileWatcher(projectPath, broadcast);
  }
}

async function switchProject(newPath: string) {
  // Stop any running Astro dev server in the old project
  stopDevServer();
  // Rebuild file watcher for the new path
  await attachWatcher(newPath);
  app.locals.projectPath = newPath;
  console.log(`[TVE Server] Switched project to: ${newPath}`);
}

app.locals.switchProject = switchProject;

// Serve injected script
app.use("/api/injected", express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api/project", projectRouter);
app.use("/api/files", filesRouter);
app.use("/api/ast", astRouter);
app.use("/api/mutations", mutationsRouter);
app.use("/api/dev-server", devServerRouter);
app.use("/api/components", componentsRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/config", configRouter);
app.use("/api/content", contentRouter);
app.use("/api/git", gitRouter);

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

// Initial watcher if started with a CLI path
if (resolvedInitialPath) {
  attachWatcher(resolvedInitialPath);
}

// Dev server proxy is path-agnostic (it reads current dev-server URL at request time)
// The proxy's projectPath/broadcast args are unused — startDevServer reads from the
// /api/dev-server/start request which picks up app.locals.projectPath at that time.
startDevServerProxy(app, resolvedInitialPath ?? "", broadcast);
setupPreviewWebSocketProxy(server);

server.listen(PORT, () => {
  console.log(`[TVE Server] Listening on http://localhost:${PORT}`);
});
