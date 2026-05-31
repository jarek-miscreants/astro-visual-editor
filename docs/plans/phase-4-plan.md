# Phase 4 — Electron Shell: Implementation Plan

Status: draft for review — do not implement until approved.

Companion to `migration-plan.md` Phase 4 (steps 17–21). Phase 3 has
produced a self-contained `tve-server` binary per OS and the editor
ships inside it as a static bundle. This phase wraps that binary in an
Electron shell so a non-technical user can install a `.exe` / `.dmg` /
`.AppImage`, double-click, and land in the editor — no terminal, no
git config, no Node install.

**Hard line:** Phase 4 does not change the server's functional surface.
Every route the editor talks to in Phase 4 is one the server already
shipped in Phases 1–3. Electron is a launcher + a few OS-integration
shims (deep links, keychain, single-instance, lifecycle). If a problem
in Phase 4 turns into "we need to add a server route," that's a Phase 1
or 2 follow-up, not a smuggled change here.

## Phase 4 scope (one-line summary per step)

| # | Step | New files | Touched files |
|---|------|-----------|---------------|
| 17 | `packages/desktop/` scaffold + child server lifecycle | `packages/desktop/package.json`, `packages/desktop/src/main.ts`, `packages/desktop/src/server-process.ts`, `packages/desktop/src/preload.ts`, `packages/desktop/tsconfig.json` | `pnpm-workspace.yaml`, root `package.json` (scripts) |
| 18 | Deep-link handler (`tve://`) | `packages/desktop/src/deep-link.ts` | `packages/desktop/src/main.ts` |
| 19 | OS keychain bridge | `packages/desktop/src/keychain-bridge.ts`, `packages/server/src/services/token-store.ts`, `packages/server/src/services/keychain-token-store.ts` | `packages/server/src/routes/auth.ts` (read tokens via store), `packages/server/src/index.ts` (TokenStore selection) |
| 20 | Lifecycle (single-instance, quit, crash) | `packages/desktop/src/lifecycle.ts` | `packages/desktop/src/main.ts` |
| 21 | Menus + window state | `packages/desktop/src/menu.ts`, `packages/desktop/src/window-state.ts` | `packages/desktop/src/main.ts`, `packages/server/src/services/state-store.ts` (window-state pref keys) |

## Guiding constraints

- **No editor code changes.** The editor is a static bundle by Phase 3.
  Phase 4 does not touch `packages/editor/` *at all* — if the editor
  needs to be aware of "I'm in Electron," that's a wrong design.
- **Electron is invisible to the server.** The server doesn't know it's
  being run by Electron vs by a user double-clicking the binary in
  Finder. Mode is detected from env vars set by the Electron parent,
  not from any sniffing.
- **Tokens never traverse IPC in plain text after the first set.** The
  keychain bridge accepts a token *once* (during the OAuth callback),
  hands it to the OS keychain, and from then on the server reads it
  by key, not by value. IPC carries opaque keys, not credentials.
- **Single-instance is mandatory.** A second `tve` invocation must
  forward to the running instance, not boot a second server on a
  random port. (Otherwise deep-link auth callbacks become
  non-deterministic.)
- **Crash recovery is graceful.** A child-server crash shows a dialog
  with a Restart button, not a silent black window.

## Prerequisites (must complete before starting Phase 4)

1. **Phase 3 PR landed on `main`.** The binary is the artifact Phase 4
   spawns; if it's still in flux, IPC contracts will churn.
2. **`tve://` URL scheme decision.** Locked in
   `phase-0-decisions.md` (or a new line item in this PR). The scheme
   lives forever once a single user has it registered, so reserve it
   carefully — `tve://` is fine for a personal-test build, but if the
   final product name diverges (e.g. shipped as "Miscreants Editor")
   the scheme should match the product, not the dev codename.
3. **Apple/Microsoft developer accounts decision.** Phase 5 needs them;
   Phase 4 ships unsigned but the Phase 5 ownership decision (personal
   vs entity) shouldn't slip past this phase.
4. **Health endpoint shipped (Phase 3 step 15c).** Phase 4 polls it.
5. **TokenStore interface available in the server.** Phase 2 shipped
   tokens to `state.db prefs.github_user_token` — that's the
   `SqlitePrefTokenStore` flavor in `cli` mode. Phase 4 introduces
   `KeychainTokenStore` and selects between them at boot. The
   interface should land *before* Phase 4 in a small refactor PR
   (`step 19a` below) so the desktop work doesn't bundle a refactor
   with new shell code.

If any prerequisite is missing, do NOT start Phase 4 — the IPC and
TokenStore boundaries are the most fragile parts and must be settled
under controlled changes.

---

## Step 17 — `packages/desktop/` + child server lifecycle

**Goal.** A double-clickable Electron app that spawns the server child
on a free localhost port, waits for `/api/health`, and opens a
`BrowserWindow` pointed at it. Crash → dialog. Quit → orderly
shutdown.

### 17a — Workspace scaffold

**Files**

- New: `packages/desktop/package.json`
- New: `packages/desktop/tsconfig.json`
- New: `packages/desktop/src/main.ts` — Electron entry.
- New: `packages/desktop/src/preload.ts` — minimal preload (window
  state IPC + nothing else for v0).
- Edited: `pnpm-workspace.yaml` — add `packages/desktop`.
- Edited: root `package.json` — `dev:desktop`, `build:desktop`
  scripts.

**Dependencies**

```jsonc
{
  "name": "@tve/desktop",
  "private": true,
  "main": "dist/main.cjs",
  "dependencies": {
    "keytar": "^7.9.0"
  },
  "devDependencies": {
    "electron": "^33.x",
    "electron-builder": "^25.x",
    "esbuild": "^0.24.x",
    "typescript": "^5.7.x"
  }
}
```

`keytar` is a runtime dep (it's used in main process at runtime).
Electron + electron-builder are devDeps (not bundled into the
shipped app — Electron is the runtime).

**Why `electron-builder` instead of `@electron-forge/maker-*`.**
Phase 5 needs `electron-updater`, which is part of the
electron-builder family. Picking electron-builder now avoids a
toolchain swap mid-distribution.

### 17b — `main.ts` — orchestration

```ts
// packages/desktop/src/main.ts
import { app, BrowserWindow } from "electron";
import { spawnServer, stopServer } from "./server-process.js";
import { setupDeepLink } from "./deep-link.js";
import { setupKeychainBridge } from "./keychain-bridge.js";
import { acquireSingleInstanceLock, setupQuitHandlers } from "./lifecycle.js";
import { restoreWindowState, persistWindowState } from "./window-state.js";
import { buildMenu } from "./menu.js";

let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;

async function bootApp() {
  if (!acquireSingleInstanceLock()) return; // second-instance forwards and exits

  await app.whenReady();

  setupDeepLink((deepLink) => {
    if (mainWindow && deepLink.startsWith("tve://auth/callback")) {
      mainWindow.webContents.send("auth:callback", deepLink);
    }
  });

  setupKeychainBridge(); // listens for IPC from server child via stdin/stdout RPC

  serverPort = await spawnServer({
    mode: "desktop",
    resourceDir: app.isPackaged
      ? path.join(process.resourcesPath, "server")
      : path.resolve(__dirname, "../../server/build/dist"),
  });

  const bounds = await restoreWindowState();
  mainWindow = new BrowserWindow({
    ...bounds,
    title: "Tailwind Visual Editor",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  buildMenu(mainWindow);
  persistWindowState(mainWindow); // attach resize/move listeners

  await mainWindow.loadURL(`http://localhost:${serverPort}/`);

  setupQuitHandlers(() => stopServer());
}

bootApp().catch((err) => {
  console.error("[desktop] boot failed:", err);
  app.exit(1);
});
```

**Webpreferences rationale.** `sandbox: true` + `contextIsolation:
true` + `nodeIntegration: false` are the modern Electron security
trio. The editor is loaded over HTTP from a local server — exactly
the same trust posture as a browser tab pointed at `localhost`.
Don't relax these for convenience.

### 17c — `server-process.ts` — spawning, waiting, killing

```ts
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import net from "node:net";

interface SpawnOpts {
  mode: "desktop";
  resourceDir: string;
}

let child: ChildProcess | null = null;

export async function spawnServer(opts: SpawnOpts): Promise<number> {
  const port = await pickFreePort();
  const binPath = serverBinaryPath(opts.resourceDir);

  child = spawn(binPath, [], {
    env: {
      ...process.env,
      TVE_MODE: "desktop",
      TVE_RESOURCE_DIR: opts.resourceDir,
      PORT: String(port),
      // App-config env vars come from the build, not the user's shell
      // — the Electron build hard-codes them at packaging time.
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
      GITHUB_APP_BROKER_URL: process.env.GITHUB_APP_BROKER_URL,
    },
    stdio: ["pipe", "pipe", "pipe"], // pipe stdin for keychain JSON-RPC
  });

  pipeServerLogs(child); // forward stdout/stderr to a rolling log file
  await waitForHealth(port, { timeoutMs: 15_000 });
  return port;
}

export async function stopServer(): Promise<void> {
  if (!child) return;
  child.kill("SIGTERM");
  await waitForExit(child, { timeoutMs: 5_000 }).catch(() => child!.kill("SIGKILL"));
  child = null;
}
```

**Free-port selection.**

```ts
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}
```

`PORT=0` would also work (the server binds whatever the kernel hands
out and prints it), but then we'd need to parse stdout. Picking the
port in the parent and passing it down is simpler and lets us avoid
a second control channel.

**Health polling.**

```ts
async function waitForHealth(port: number, opts: { timeoutMs: number }) {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error("server failed to report health within timeout");
}
```

100 ms intervals give a sub-second perceived boot when the server is
quick, and a 15 s ceiling tolerates SQLite migrations on first boot.

**Why not `app.requestSingleInstanceLock()` *and* a free port?**
Single-instance lock is in `lifecycle.ts` (step 20) — if a lock is
already held, the second invocation forwards its arguments and exits
*before* `spawnServer` runs. So free-port selection only ever
happens once per running app.

**Server logs.** stdout/stderr → `~/.tve/logs/desktop-{date}.log`,
size-capped at 10 MB with a 5-file rotation. Help → "Open Logs"
(step 21) opens the directory.

### 17d — Crash handling

```ts
child.on("exit", (code, signal) => {
  if (code === 0 || signal === "SIGTERM") return; // orderly shutdown
  showCrashDialog({
    code,
    signal,
    onRestart: () => relaunchApp(),
    onShowLogs: () => openLogsDir(),
  });
});
```

`showCrashDialog` is a modal with three buttons: **Restart** (calls
`app.relaunch(); app.exit(0)`), **Show Logs**, **Quit**. Default is
Restart. Restart count cap: 3 within 60 s → flip to "Quit" default
to avoid loops.

**Tests**

`packages/desktop/src/__tests__/server-process.test.ts` (Vitest, no
Electron):

- `pickFreePort` returns a free port and the listener is closed.
- `waitForHealth` resolves when the URL returns 200, rejects on
  timeout.
- `stopServer` sends SIGTERM, then SIGKILL after the timeout.
- These are pure-Node tests, no Electron required.

The full lifecycle (Electron + child server + crash dialog) is
covered by the Phase 4 manual E2E checklist; an Electron-running
test harness (Spectron / Playwright-electron) is deferred to Phase 5
distribution work.

---

## Step 18 — Deep-link handler (`tve://`)

**Goal.** When the user clicks "Authorize" on github.com, the OAuth
callback redirect lands on `tve://auth/callback?code=...&state=...`.
The OS hands that URL to the registered TVE app, which forwards it
to the running instance, which sends it to the renderer, which
re-fires the existing in-app `/api/auth/github/callback` request.

This works around the fact that github.com cannot redirect to
`http://localhost:{ephemeral-port}/` — the port is per-launch and
the App config can only register a fixed callback URL. `tve://` is
that fixed callback URL; the app is responsible for getting the
code to the right port locally.

**Files**

- New: `packages/desktop/src/deep-link.ts`
- Edited: `packages/desktop/src/main.ts` — wire `setupDeepLink`.
- Edited (Phase 2 server route): `routes/auth.ts` continues to accept
  `?code=…&state=…` exactly as today. The deep-link layer is purely
  additive on the Electron side; the server route doesn't change.

**Cross-OS plumbing.**

```ts
// deep-link.ts
import { app } from "electron";

export function setupDeepLink(onDeepLink: (url: string) => void) {
  // Register the scheme. Idempotent on most OSes.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("tve", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("tve");
  }

  // macOS: open-url event.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    onDeepLink(url);
  });

  // Windows/Linux: deep link arrives in argv on second-instance.
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((a) => a.startsWith("tve://"));
    if (deepLink) onDeepLink(deepLink);
  });

  // Cold start with deep link: macOS fires open-url before
  // whenReady; Windows/Linux pass it in argv. Handle both.
  if (process.platform !== "darwin") {
    const cold = process.argv.find((a) => a.startsWith("tve://"));
    if (cold) queueMicrotask(() => onDeepLink(cold));
  }
}
```

**The renderer side.** Phase 2's editor already issues
`POST /api/auth/github/callback` with `{ code, state }`. To plumb the
deep-link payload into that flow:

1. Main forwards the URL to the renderer via `webContents.send("auth:callback", url)`.
2. Preload exposes `window.tve?.onAuthCallback(cb)` (a one-line
   `ipcRenderer.on` wrapper) — the only renderer-facing API in v0.
3. The editor's `auth-store` checks for `window.tve?.onAuthCallback`
   at mount; if present, registers a listener; on event, parses
   `code` and `state` from the URL and calls the existing server
   endpoint. If absent (browser dev mode), the existing
   `consumeSignedInQuery` URL-param flow still works.

**Why the renderer drives the callback, not main.** The server's
auth route is tied to a session cookie / state nonce that the
renderer holds. Routing through main would require duplicating
session logic in main process. Renderer-driven keeps responsibility
in one place.

**State validation unchanged.** Phase 2's CSRF state check still
runs server-side. If a malicious app on the user's machine fires
`tve://auth/callback?code=foo&state=wrong`, the existing 4xx
response covers it.

**Dev-mode fallback.** In `pnpm dev` (no Electron), GitHub's callback
goes to `http://localhost:3011/api/auth/github/callback?code=...`
directly via Phase 2 routing. Phase 4 *adds* `tve://` for the
packaged app; it doesn't replace the http callback.

**Tests**

`packages/desktop/src/__tests__/deep-link.test.ts`:

- `parseDeepLink("tve://auth/callback?code=A&state=B")` extracts
  `{ code: "A", state: "B" }`. (Pure function, no Electron.)
- `parseDeepLink("tve://something-else")` returns null.
- `parseDeepLink("https://example.com")` returns null.

End-to-end deep-link verification is in the manual E2E checklist
(open `tve://auth/callback?code=ZZZ` from another app, observe the
editor handle the rejection of an unknown state).

---

## Step 19 — OS keychain bridge

**Goal.** The server process never touches the OS keychain directly.
`keytar` lives in the Electron main process; the server reads/writes
tokens by key over a JSON-RPC channel on the child's stdin/stdout.

This keeps `keytar` (a native module with finicky cross-platform
build quirks) out of the SEA-bundled server entirely. It also means
the keychain prompt UI (macOS especially) attributes correctly to
"Tailwind Visual Editor.app" instead of "node".

**Files**

- New (server, in Phase 2 follow-up): `packages/server/src/services/token-store.ts`
  — `TokenStore` interface + the existing SQLite-backed implementation
  pulled out of `attachAuthStateStore`.
- New (server): `packages/server/src/services/keychain-token-store.ts`
  — talks JSON-RPC over `process.stdin` / `process.stdout`.
- New (desktop): `packages/desktop/src/keychain-bridge.ts` — listens
  on the child's stdin, services keychain calls.
- Edited (server): `routes/auth.ts` — read/write through `TokenStore`
  abstraction (no behavior change in cli mode).
- Edited (server): `index.ts` — pick the store based on `TVE_MODE`
  + presence of the JSON-RPC channel.

### 19a — `TokenStore` interface (server-side refactor PR, lands first)

```ts
// services/token-store.ts
export interface TokenStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const TOKEN_KEY_GITHUB_USER = "github.user.access_token";
```

Two implementations:

- `SqlitePrefTokenStore(stateStore)` — what's already shipped, pulled
  out of `attachAuthStateStore`.
- `KeychainTokenStore(channel)` — Phase 4 step 19c.

`index.ts` picks based on:

```ts
const tokenStore: TokenStore =
  TVE_MODE === "desktop" && hasKeychainChannel()
    ? new KeychainTokenStore(getKeychainChannel())
    : new SqlitePrefTokenStore(stateStore);
```

Falls back to SQLite-backed store if launched as a standalone
binary without an Electron parent (someone running `tve-server` from
a terminal in `desktop` mode). This is a degraded-mode path —
documented but not the supported user flow.

### 19b — JSON-RPC channel

stdin/stdout newline-delimited JSON. Each request:

```json
{ "id": 17, "method": "keychain.get", "params": ["github.user.access_token"] }
```

Each response:

```json
{ "id": 17, "result": "ghu_..." }
```

or `{ "id": 17, "error": { "code": "not_found", "message": "..." } }`.

**Why stdin/stdout, not a TCP socket?** Three reasons:

1. **Authenticity.** Anything on stdin is from the parent process —
   no other process can connect.
2. **Lifecycle.** When the parent dies, the child's stdin EOFs;
   keychain calls fail loudly instead of hanging.
3. **No port allocation.** A second port for IPC is one more thing
   that could clash.

**Why not Electron's `MessagePortMain`?** It would work, but the
server child is *not* an Electron utility process — it's a separate
SEA binary. `MessagePortMain` requires Electron on both ends. stdin
JSON-RPC is interop-friendly: a future port to a non-Electron
desktop runtime (Tauri, WebView2, etc.) keeps the same wire format.

**Keychain service ID & account format.** `keytar.setPassword(
service, account, password)`:

- service: `"tve"` (constant — this is the app)
- account: `"${appId}:${userId}"` for user tokens, `"installation:
  ${installationId}"` for any future cached installation tokens
  (today these stay in-memory; this leaves room).

Service+account is the keychain primary key, so a future change to
account format is a one-time migration.

### 19c — Implementation

```ts
// keychain-bridge.ts (main process)
import keytar from "keytar";
import type { ChildProcess } from "node:child_process";

const SERVICE = "tve";

export function setupKeychainBridge(child: ChildProcess) {
  let buffer = "";
  child.stdout!.on("data", async (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const msg = JSON.parse(line);
      if (!msg.method?.startsWith("keychain.")) continue; // not for us
      const result = await handleKeychainCall(msg);
      child.stdin!.write(JSON.stringify(result) + "\n");
    }
  });
}

async function handleKeychainCall(msg: { id: number; method: string; params: unknown[] }) {
  try {
    switch (msg.method) {
      case "keychain.get":
        return { id: msg.id, result: await keytar.getPassword(SERVICE, msg.params[0] as string) };
      case "keychain.set":
        await keytar.setPassword(SERVICE, msg.params[0] as string, msg.params[1] as string);
        return { id: msg.id, result: null };
      case "keychain.delete":
        await keytar.deletePassword(SERVICE, msg.params[0] as string);
        return { id: msg.id, result: null };
    }
  } catch (err) {
    return { id: msg.id, error: { code: "keychain_error", message: String(err) } };
  }
}
```

```ts
// keychain-token-store.ts (server side, talks the same protocol)
let nextId = 1;
const pending = new Map<number, (msg: any) => void>();

process.stdin.on("data", (chunk) => {
  // ... parse, route to pending[id]
});

function call(method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result));
    process.stdout.write(JSON.stringify({ id, method, params }) + "\n");
  });
}

export class KeychainTokenStore implements TokenStore {
  async get(key: string)            { return (await call("keychain.get", [key])) as string | null; }
  async set(key: string, value: string) { await call("keychain.set", [key, value]); }
  async delete(key: string)         { await call("keychain.delete", [key]); }
}
```

**Edge case — stdout pollution.** The server already writes log lines
to stdout. Once the keychain channel is active, all logs must go to
stderr instead. `index.ts` reroutes `console.log`/`console.error`
when `TVE_MODE === "desktop" && process.send` (Electron parent
detected via the `IPC` env hint we set in 17c). One line in `index.ts`,
documented in the boot-mode comment.

**Tests**

`packages/server/src/services/__tests__/keychain-token-store.test.ts`:

- Round-trip: write to a stub stdin/stdout pair, expect the
  request to round-trip with the right shape.
- `get` resolves with the keychain's response.
- `delete` rejects on `error` payload.
- Concurrent calls don't cross-pollute IDs.

`packages/desktop/src/__tests__/keychain-bridge.test.ts`:

- Pure-function test: `parseRpcLine` handles malformed JSON
  gracefully, multi-line buffers, partial lines.

The `keytar` integration itself isn't unit-tested (it touches the
real OS keychain). It's covered by the manual E2E checklist:
"Sign in, quit, reopen, expect no second sign-in prompt."

---

## Step 20 — Lifecycle (single-instance, quit, crash)

**Goal.** Exactly one TVE process per user session. Quit is
predictable (Astro → server child → Electron). Crash is recoverable.

**Files**

- New: `packages/desktop/src/lifecycle.ts`
- Edited: `packages/desktop/src/main.ts`

### 20a — Single-instance lock

```ts
// lifecycle.ts
import { app, BrowserWindow } from "electron";

export function acquireSingleInstanceLock(): boolean {
  const gotIt = app.requestSingleInstanceLock();
  if (!gotIt) {
    app.quit();
    return false;
  }
  app.on("second-instance", (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // deep-link.ts also listens to second-instance for argv['tve://...']
  });
  return true;
}
```

**Order of event handlers.** `lifecycle` and `deep-link` both attach
to `second-instance`. They're independent — Electron supports
multiple listeners per event. No coordination needed.

### 20b — Orderly quit

```ts
export function setupQuitHandlers(stopServer: () => Promise<void>) {
  let quitting = false;

  app.on("before-quit", async (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    try {
      await stopAstroDevServer();   // POST /api/dev-server/stop on the running server
      await stopServer();           // SIGTERM the SEA child
    } catch (err) {
      console.error("[desktop] shutdown error:", err);
    } finally {
      app.quit();                   // re-fires before-quit but quitting=true skips
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

async function stopAstroDevServer() {
  if (!serverPort) return;
  try {
    await fetch(`http://127.0.0.1:${serverPort}/api/dev-server/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* server may already be down */ }
}
```

**Why ask the server to stop the dev server, not kill it from main.**
The server already manages the dev-server child via
`services/astro-dev-server.ts`. Asking it nicely is one HTTP call;
duplicating the lifecycle logic in Electron would be a second source
of truth.

### 20c — Crash recovery

Wired in step 17d. Single source of truth: `setupQuitHandlers` does
not run when the child crashes (because Electron isn't quitting —
only the child is). The child's `exit` handler (in
`server-process.ts`) shows the dialog.

**Tests**

`packages/desktop/src/__tests__/lifecycle.test.ts`:

- Mock `app.requestSingleInstanceLock`: lock acquired → true; lock
  not acquired → `app.quit` called and returns false.
- `setupQuitHandlers` calls `stopServer` exactly once even if
  `before-quit` fires twice.

---

## Step 21 — Menus + window state

**Goal.** Menus that match OS conventions (File / Edit / View / Help
on Win/Linux; macOS has the additional app menu). Window position
and size persist across launches.

**Files**

- New: `packages/desktop/src/menu.ts`
- New: `packages/desktop/src/window-state.ts`
- Edited: `packages/server/src/services/state-store.ts` — add three
  pref keys: `window.bounds`, `window.maximized`, `window.display_id`.
  (Pure key additions, no migration.)

### 21a — Menu

```ts
// menu.ts
import { Menu, MenuItemConstructorOptions, BrowserWindow, shell } from "electron";

export function buildMenu(window: BrowserWindow) {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Repo from GitHub…", click: () => window.webContents.send("menu:open-github") },
        { label: "Open Local Folder…",     click: () => window.webContents.send("menu:open-local") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },   // standard cut/copy/paste/select all
    {
      label: "View",
      submenu: [
        { label: "Toggle Preview", accelerator: "CmdOrCtrl+P", click: () => window.webContents.send("menu:toggle-preview") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        { label: "Open Logs Folder",    click: () => shell.openPath(logsDir()) },
        { label: "Visit Project Site",  click: () => shell.openExternal("https://github.com/anthropics/tailwind-visual-editor") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

**Renderer-side wiring.** "Open Repo from GitHub…" sends an IPC
event the renderer listens for; the editor's `AuthButton` /
`GitHubRepoPickerDialog` already handle the actual open flow.
Same for "Toggle Preview" — the existing toolbar has the action;
the menu just fires the same handler.

The `preload.ts` exposes `window.tve.onMenuEvent(eventName, cb)`
to keep the surface tiny — no `ipcRenderer` direct exposure.

### 21b — Window state persistence

```ts
// window-state.ts
import { BrowserWindow, screen } from "electron";

const KEY_BOUNDS    = "window.bounds";
const KEY_MAXIMIZED = "window.maximized";

export async function restoreWindowState(): Promise<Electron.Rectangle> {
  const stored = await getPref(KEY_BOUNDS); // hits server's /api/prefs/* — see below
  const display = screen.getPrimaryDisplay();
  const fallback = { x: undefined, y: undefined, width: 1400, height: 900 };
  if (!stored) return fallback;
  const bounds = JSON.parse(stored);
  // Sanity: if the saved bounds are off-screen (external monitor unplugged),
  // fall back to the primary display center.
  if (!isOnScreen(bounds, screen.getAllDisplays())) return fallback;
  return bounds;
}

export function persistWindowState(window: BrowserWindow) {
  const save = debounce(() => {
    setPref(KEY_BOUNDS, JSON.stringify(window.getBounds()));
    setPref(KEY_MAXIMIZED, String(window.isMaximized()));
  }, 500);
  window.on("resize", save);
  window.on("move", save);
  window.on("maximize", save);
  window.on("unmaximize", save);
}
```

**Where do `getPref` / `setPref` live?** The server already has
`prefs` in SQLite. Add two thin server routes — `GET /api/prefs/:key`
and `PUT /api/prefs/:key` — gated to the `window.*` namespace and
required to come from `127.0.0.1`. The desktop main process talks to
its child server over the same HTTP channel the renderer uses; no
need for a separate IPC mechanism for window state.

(If we later want to remove the HTTP round-trip for window state,
we can move it to a small file in `~/.tve/window.json`. But layering
on the existing `prefs` table avoids a second persistence path.)

**Tests**

`packages/desktop/src/__tests__/window-state.test.ts`:

- `isOnScreen` returns false when bounds are entirely outside all
  display rectangles.
- Bounds inside any display → true.
- Debounced save fires once for a burst of 10 resize events within
  500 ms.

---

## Test plan

### Phase 4 unit tests (per file)

- `server-process.test.ts` — port picker, health polling, kill.
- `deep-link.test.ts` — URL parsing.
- `keychain-bridge.test.ts` — JSON-RPC line buffering.
- `keychain-token-store.test.ts` — protocol round-trip via stub
  stdin/stdout.
- `lifecycle.test.ts` — single-instance gate, quit handler
  idempotency.
- `window-state.test.ts` — off-screen detection, debounce.

### Phase 4 integration tests (Vitest, no Electron)

- `keychain-protocol.test.ts` — Spawn the SEA binary as a child of a
  Node test runner that plays the role of "main process": speak
  JSON-RPC keychain calls, observe the server's behavior on
  `/api/auth/whoami` after `keychain.set` populates a token.

### Phase 4 manual E2E checklist (per OS, captured in PR)

| Scenario | Expected |
|---|---|
| Cold install, double-click, sign in | OAuth flow completes via `tve://`. Sign-in persists across restarts. |
| Click "Open Repo from GitHub…" → pick repo | Repo cloned, deps installed, editor renders the page. |
| Edit a class → push | Commit lands on github.com under the user's identity. |
| Quit (Cmd/Ctrl+Q) → reopen | Same window bounds, same recent project, no re-authenticate prompt. |
| Crash the server child (kill -9 the SEA process from terminal) | Dialog appears with Restart / Show Logs / Quit. Restart works. |
| Launch a second `tve` from terminal while one is running | Existing window focuses; second process exits. |
| Click `tve://auth/callback?code=garbage&state=garbage` from another app | Editor surfaces "auth failed" inline; no crash. |
| Quit while Astro dev server is running | Astro stops cleanly, server shuts down, no zombie node processes. |

### Regression matrix (must still pass)

- `pnpm dev` source workflow against `test-project/`: unchanged.
- All Phase 3 binary smoke tests: unchanged.
- All 240+ server unit tests: unchanged.
- 44 broker tests: unchanged.

---

## Exit criteria

The phase is done when:

1. `pnpm --filter @tve/desktop dev` boots an unsigned Electron app
   that wraps the local `tve-server` binary and shows the editor.
2. `pnpm --filter @tve/desktop build` produces an unsigned `.exe`
   (Windows), `.dmg` (macOS), and `.AppImage` (Linux). These
   *install and run* on a fresh VM without Node, git, or any
   prior TVE artifact.
3. The full E2E checklist passes on all three OSes.
4. Tokens are stored in the OS keychain (verified via Keychain
   Access on macOS, Credential Manager on Windows, libsecret on
   Linux). They are *not* in `state.db prefs`.
5. `tve://` deep-link cold-start works on all three OSes.
6. Single-instance lock works: a second invocation focuses the
   first window and exits.
7. Window state persists: resize → quit → relaunch puts the window
   back where it was.
8. Crash dialog works: kill the server child, expect dialog, click
   Restart, expect a working window.
9. `docs/plans/follow-ups.md` records any Phase 4 deviations.

## Deviations / risks worth flagging up front

- **Linux desktop integration is per-distribution.** Deep-link
  registration on Linux relies on `xdg-mime` + a `.desktop` file
  produced by electron-builder. AppImage runtime registration is
  finicky; some distros require the user to run the installed
  AppImage once with `--integrate` before `tve://` works. Document
  this in the README rather than trying to make it transparent.
- **`keytar` is in maintenance mode.** Atom's keytar fork is widely
  used but the upstream is no longer actively maintained. If it
  breaks on a future Node ABI, we move to `@napi-rs/keyring` —
  same OS keychain APIs, different bindings. Behind the
  `KeychainTokenStore` interface, the swap is a one-file change.
- **`process.resourcesPath` location.** electron-builder packages
  resources into `Contents/Resources/` (macOS), `resources/` (Windows
  alongside the `.exe`), or inside the AppImage SquashFS (Linux).
  All three resolve the same way through `process.resourcesPath`,
  but the cwd at boot time differs — never assume `process.cwd()`
  is the resource dir.
- **macOS Gatekeeper without signing.** Phase 4 ships unsigned, so
  the user has to right-click → Open the first time. Document this
  in the dev README. Phase 5 fixes it.
- **Windows SmartScreen warning** for unsigned `.exe` is unavoidable
  in Phase 4. Same fix applies in Phase 5.
- **stdout vs stderr discipline.** Once the keychain channel is
  active, *anything* on stdout that isn't a JSON-RPC frame breaks
  the parser. Add a CI check that runs the server with stdin/stdout
  piped and grep the stdout for non-JSON content; fail the build if
  any log line escapes.
- **Update channel readiness.** electron-builder has all the hooks
  for `electron-updater` but Phase 4 doesn't wire it up. Don't
  configure GH Releases as the publish target until Phase 5 — a
  partial config could surprise-publish a build.

## What this plan does NOT cover

- Code signing / notarization / SmartScreen — Phase 5.
- `electron-updater` — Phase 5.
- Crash reporting (Sentry / Bugsnag) — backlog. Phase 4 logs to a
  local file; remote telemetry is a separate decision.
- In-app onboarding tour — backlog.
- macOS dock badging, Windows taskbar progress — out of scope for
  v0.1.
- Tray icon / background mode — explicitly out of scope; TVE is a
  foreground editor, not a daemon.
- Auto-launch at login — out of scope.
- Multi-window — single-window only in v0.1; multi-project work
  uses repo switching, not multi-window.
