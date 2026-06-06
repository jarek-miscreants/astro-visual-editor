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
import { assetsRouter } from "./routes/assets.js";
import { seoRouter } from "./routes/seo.js";
import { projectRouter } from "./routes/project.js";
import { gitRouter } from "./routes/git.js";
import { authRouter, attachAuthStateStore, getCurrentAccessToken } from "./routes/auth.js";
import { githubRouter } from "./routes/github.js";
import { requireEditorOrigin } from "./lib/require-editor-origin.js";
import { setupFileWatcher } from "./services/file-watcher.js";
import { stopDevServer } from "./services/astro-dev-server.js";
import { getGitTransport, setGitTransport, createTokenGitTransport } from "./services/git-transport.js";
import { createBrokerInstallationTokenSource } from "./services/installation-token-source.js";
import { createStateStore } from "./services/state-store.js";
import { attachStateStore } from "./services/recent-projects.js";
import { loadGithubAppConfig } from "./lib/github-app-config.js";
import type { FSWatcher } from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT) || 3011;
const INITIAL_PROJECT_PATH = process.env.TVE_PROJECT_PATH || process.argv[2] || "";

type TveMode = "cli" | "desktop";
const TVE_MODE: TveMode = process.env.TVE_MODE === "desktop" ? "desktop" : "cli";
console.log(`[TVE Server] Mode: ${TVE_MODE}`);

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
app.locals.mode = TVE_MODE;
app.locals.wss = wss;
// Phase 1: ambient pass-through. Phase 2 swaps in a token-injecting
// transport when mode === "desktop". The transport module owns the
// active instance — `app.locals.gitTransport` is a convenience handle
// for routes that prefer reading from request state.
app.locals.gitTransport = getGitTransport();

// GitHub App identity (env-driven; null when unconfigured / CLI-only).
// Validated at boot — partial config throws here rather than failing
// at first OAuth redirect.
const githubAppConfig = loadGithubAppConfig();
app.locals.githubAppConfig = githubAppConfig;
if (githubAppConfig) {
  console.log(
    `[TVE Server] GitHub App: ${githubAppConfig.slug} (id=${githubAppConfig.appId})${githubAppConfig.brokerBaseUrl ? "" : " — broker URL not set, auth flows disabled"}`
  );
} else {
  console.log(`[TVE Server] No GitHub App configured (CLI mode)`);
}

// Persistent state store — opens ~/.tve/state.db (or TVE_HOME override).
// Recent-projects + future GitHub auth/install/repo metadata both live
// here. We open it eagerly so the boot fails loudly if the DB is
// unreadable rather than at first write.
const stateStore = createStateStore();
stateStore.open().then(
  () => {
    // Reconcile the persisted App ID with the configured one. On a
    // change, app-bound rows are dropped so stale installation IDs
    // don't leak across registrations.
    if (githubAppConfig) {
      const sync = stateStore.syncAppContext(githubAppConfig.appId);
      if (sync.changed) {
        if (sync.previousAppId === null) {
          console.log(
            `[TVE Server] Recorded App ID ${githubAppConfig.appId} (first boot with auth configured)`
          );
        } else {
          console.log(
            `[TVE Server] App ID changed (${sync.previousAppId} → ${githubAppConfig.appId}) — cleared installations + repos`
          );
        }
      }
    }
    attachStateStore(stateStore, TVE_MODE);
    attachAuthStateStore(stateStore);
    app.locals.stateStore = stateStore;

    // Token-injecting git transport — replaces the ambient pass-through
    // when the GitHub App is configured. Push/pull mint a fresh
    // installation token via the broker per call. Repos without a
    // recorded installation_id (local-only, manually-cloned) still
    // fall through to ambient auth.
    if (githubAppConfig) {
      const tokenSource = createBrokerInstallationTokenSource(
        githubAppConfig,
        stateStore,
        { getUserToken: getCurrentAccessToken }
      );
      setGitTransport(createTokenGitTransport(tokenSource));
      app.locals.gitTransport = getGitTransport();
      console.log(
        `[TVE Server] Git transport: token-injecting via broker (installation tokens minted per push/pull)`
      );
    } else {
      console.log(`[TVE Server] Git transport: ambient (no GitHub App configured)`);
    }
    console.log(`[TVE Server] State store ready`);
  },
  (err) => {
    console.error(`[TVE Server] Failed to open state store:`, err);
  }
);

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
//
// `requireEditorOrigin` gates routes that mint GitHub tokens, write
// repos to disk, switch the active project, or shut the server down —
// so a drive-by browser tab the user happens to have open can't drive
// them via a cross-origin fetch. The OAuth `start`/`callback` GET
// navigations are exempt (no usable Origin) and rely on the CSRF state
// nonce in routes/auth.ts instead.
app.use("/api/project", requireEditorOrigin, projectRouter);
app.use("/api/files", filesRouter);
app.use("/api/ast", astRouter);
app.use("/api/mutations", mutationsRouter);
app.use("/api/dev-server", devServerRouter);
app.use("/api/components", componentsRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/config", configRouter);
app.use("/api/content", contentRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/seo", seoRouter);
app.use("/api/git", gitRouter);
app.use("/api/auth", authRouter);
app.use("/api/github", requireEditorOrigin, githubRouter);

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
