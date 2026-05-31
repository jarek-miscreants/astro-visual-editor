#!/usr/bin/env node
// Phase 0 CI guardrail. Boots the TVE server in cli mode against
// test-project/, hits /api/project/info and parses one page via /api/ast.
// Stays green for the lifetime of feat/local-saas — if it breaks on main,
// the migration has regressed the CLI flow.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ?? "3099";
const PROJECT = path.join(repoRoot, "test-project");
const SERVER_DIR = path.join(repoRoot, "packages/server");
const SERVER_ENTRY = path.join(SERVER_DIR, "src/index.ts");
const PAGE = "src/pages/index.astro";
const READY_TIMEOUT_MS = 30_000;

const VERBOSE = process.env.TVE_SMOKE_VERBOSE === "1";
let proc = null;

async function shutdown(exitCode) {
  if (proc && proc.exitCode === null && !proc.killed) {
    if (process.platform === "win32") {
      // proc.kill on Windows triggers a libuv UV_HANDLE_CLOSING assertion
      // in the parent for tsx-loaded children. taskkill /F sidesteps libuv
      // entirely — the OS terminates the process without parent involvement.
      try {
        const { spawnSync } = await import("node:child_process");
        spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
          stdio: "ignore",
        });
      } catch {}
    } else {
      const dead = new Promise((resolve) => proc.once("exit", resolve));
      try { proc.kill("SIGTERM"); } catch {}
      await Promise.race([dead, new Promise((r) => setTimeout(r, 2000))]);
    }
  }
  process.exit(exitCode);
}
process.on("SIGINT", () => { shutdown(130); });
process.on("SIGTERM", () => { shutdown(143); });

function fail(msg) {
  console.error(`[cli-smoke] FAIL: ${msg}`);
  shutdown(1);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function waitForReady(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastErr;
  while (Date.now() < deadline) {
    try { return await fetchJson(url); }
    catch (e) { lastErr = e; await sleep(250); }
  }
  throw new Error(`server not ready after ${READY_TIMEOUT_MS}ms (${lastErr?.message ?? "?"})`);
}

console.log(`[cli-smoke] booting server on :${PORT} for ${PROJECT}`);
// `node --import tsx` with cwd=packages/server makes tsx resolvable from
// the server package's own node_modules. Avoids depending on a global
// pnpm or shell:true (deprecated in Node 24).
// Silence child stdio by default. Inheriting / piping the child's stdio
// triggers a UV_HANDLE_CLOSING assertion in the parent on Windows when we
// kill at shutdown (Node + libuv quirk). Smoke asserts via HTTP, so logs
// aren't needed for correctness. Set TVE_SMOKE_VERBOSE=1 to inherit them
// for diagnosis on Linux/CI.
proc = spawn(
  process.execPath,
  ["--import", "tsx", SERVER_ENTRY],
  {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT,
      TVE_PROJECT_PATH: PROJECT,
    },
    stdio: VERBOSE ? ["ignore", "inherit", "inherit"] : "ignore",
    detached: true,
  },
);
proc.unref();

proc.on("exit", (code, signal) => {
  if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== null) {
    fail(`server exited unexpectedly (code=${code}, signal=${signal})`);
  }
});

const base = `http://127.0.0.1:${PORT}`;
const info = await waitForReady(`${base}/api/project/info`);
if (info.mode !== "cli") fail(`expected mode=cli, got ${JSON.stringify(info.mode)}`);
if (typeof info.path !== "string" || !info.path.endsWith("test-project")) {
  fail(`expected path ending in test-project, got ${info.path}`);
}
console.log(`[cli-smoke] /api/project/info OK (mode=${info.mode})`);

const parsed = await fetchJson(`${base}/api/ast/${PAGE}`);
const nodes = Array.isArray(parsed?.ast) ? parsed.ast : null;
if (!nodes || nodes.length === 0) {
  fail(`empty ast for ${PAGE}: ${JSON.stringify(parsed).slice(0, 200)}`);
}
console.log(`[cli-smoke] /api/ast/${PAGE} OK (top-level nodes=${nodes.length})`);

console.log("[cli-smoke] PASS");
await shutdown(0);
