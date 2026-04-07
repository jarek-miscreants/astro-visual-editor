#!/usr/bin/env node

import { spawn } from "child_process";
import { createInterface } from "readline";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_PROJECT = path.join(ROOT, "test-project");

async function main() {
  let projectPath = process.argv[2];

  if (!projectPath) {
    projectPath = await promptForPath();
  }

  projectPath = path.resolve(projectPath);

  // Verify it's an Astro project
  const hasAstro =
    fs.existsSync(path.join(projectPath, "astro.config.mjs")) ||
    fs.existsSync(path.join(projectPath, "astro.config.js")) ||
    fs.existsSync(path.join(projectPath, "astro.config.ts"));

  if (!hasAstro) {
    console.warn(`\x1b[33m⚠ No astro.config found in ${projectPath}\x1b[0m`);
    console.warn("  The editor works best with Astro projects.\n");
  }

  console.log(`\n\x1b[36m╔══════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[36m║\x1b[0m  \x1b[1mTailwind Visual Editor\x1b[0m              \x1b[36m║\x1b[0m`);
  console.log(`\x1b[36m╚══════════════════════════════════════╝\x1b[0m\n`);
  console.log(`  Project: \x1b[32m${projectPath}\x1b[0m`);
  console.log(`  Editor:  \x1b[36mhttp://localhost:3005\x1b[0m`);
  console.log(`  Backend: \x1b[36mhttp://localhost:3001\x1b[0m\n`);

  // Start backend — quote path with spaces for shell mode on Windows
  const isWindowsServer = process.platform === "win32";
  const npxCmdServer = isWindowsServer ? "npx.cmd" : "npx";
  const quotedPath = isWindowsServer && projectPath.includes(" ")
    ? `"${projectPath}"`
    : projectPath;
  const server = spawn(
    npxCmdServer,
    ["tsx", "src/index.ts", quotedPath],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.join(ROOT, "packages/server"),
      shell: isWindowsServer,
    }
  );

  server.stdout.on("data", (data) => {
    const line = data.toString().trim();
    if (line) console.log(`  \x1b[90m[server]\x1b[0m ${line}`);
  });

  server.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line && !line.includes("ExperimentalWarning") && !line.includes("DeprecationWarning")) {
      console.error(`  \x1b[31m[server]\x1b[0m ${line}`);
    }
  });

  // Wait for server to be ready
  await waitForServer("http://localhost:3001/api/project/info", 10000);

  // Start editor
  const isWindows = process.platform === "win32";
  const npxCmd = isWindows ? "npx.cmd" : "npx";

  const editor = spawn(npxCmd, ["vite", "--port", "3005"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: path.join(ROOT, "packages/editor"),
    shell: isWindows,
  });

  editor.stdout.on("data", (data) => {
    const line = data.toString().trim();
    if (line) console.log(`  \x1b[90m[editor]\x1b[0m ${line}`);
  });

  editor.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line && !line.includes("ExperimentalWarning")) {
      console.error(`  \x1b[31m[editor]\x1b[0m ${line}`);
    }
  });

  console.log(`\n  \x1b[32m✓ Starting...\x1b[0m Open \x1b[1mhttp://localhost:3005\x1b[0m in your browser\n`);
  console.log(`  Press \x1b[1mCtrl+C\x1b[0m to stop\n`);

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\n  Shutting down...");
    server.kill();
    editor.kill();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.kill();
    editor.kill();
    process.exit(0);
  });
}

function promptForPath() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log(`\n\x1b[1mTailwind Visual Editor\x1b[0m\n`);
    console.log(`  Enter path to your Astro project, or press Enter for test project.\n`);

    rl.question(`  Project path [\x1b[90m${DEFAULT_PROJECT}\x1b[0m]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || DEFAULT_PROJECT);
    });
  });
}

async function waitForServer(url, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
