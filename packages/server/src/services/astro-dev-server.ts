import { spawn, type ChildProcess } from "child_process";
import type { DevServerStatus, DevServerStartError } from "@tve/shared";
import { runDevServerPreflight, parseAstroError } from "./dev-server-preflight.js";

let devServerProcess: ChildProcess | null = null;
let devServerUrl: string | null = null;
let devServerStatus: DevServerStatus = "stopped";

export function getDevServerStatus() {
  return { status: devServerStatus, url: devServerUrl };
}

/** Error thrown by startDevServer when the spawn or preflight produces a
 *  parseable structured error. The route handler unwraps `cause` to return
 *  it to the client without losing the parsed shape. */
export class DevServerStartFailure extends Error {
  cause: DevServerStartError;
  constructor(error: DevServerStartError) {
    super(error.message);
    this.name = "DevServerStartFailure";
    this.cause = error;
  }
}

export async function startDevServer(
  projectPath: string,
  broadcast: (message: object) => void
): Promise<string> {
  if (devServerProcess) {
    if (devServerUrl) return devServerUrl;
    throw new Error("Dev server is already starting");
  }

  // Preflight: run `astro sync` to surface schema / config errors before the
  // long-lived `astro dev` spawn. Cheap (~1s) and catches the class of bug
  // where Astro starts, prints its URL, then exits 1 a moment later — which
  // would otherwise look like a successful start to the editor.
  devServerStatus = "starting";
  console.log("[DevServer] Running preflight (astro sync)...");
  const preflight = await runDevServerPreflight(projectPath);
  if (preflight) {
    devServerStatus = "error";
    console.error(`[DevServer] Preflight failed: ${preflight.message}`);
    broadcast({ type: "dev-server:error", message: preflight.message, error: preflight });
    throw new DevServerStartFailure(preflight);
  }

  return new Promise((resolve, reject) => {
    console.log("[DevServer] Starting Astro dev server...");

    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "npx.cmd" : "npx";
    devServerProcess = spawn(cmd, ["astro", "dev", "--port", "4321"], {
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWindows,
    });

    // Buffer stderr so we can parse it into a structured error on early exit
    let stderrBuffer = "";
    let stdoutBuffer = "";
    let resolved = false;

    devServerProcess.stdout?.on("data", (data: Buffer) => {
      const line = data.toString();
      stdoutBuffer += line;
      console.log(`[DevServer] ${line.trim()}`);

      broadcast({ type: "dev-server:log", line: line.trim() });

      const urlMatch = line.match(/http:\/\/localhost:\d+/);
      if (urlMatch && !devServerUrl) {
        devServerUrl = urlMatch[0];
        devServerStatus = "running";
        resolved = true;
        console.log(`[DevServer] Ready at ${devServerUrl}`);
        broadcast({ type: "dev-server:ready", url: devServerUrl });
        resolve(devServerUrl);
      }
    });

    devServerProcess.stderr?.on("data", (data: Buffer) => {
      const line = data.toString();
      stderrBuffer += line;
      console.error(`[DevServer Error] ${line.trim()}`);
      broadcast({ type: "dev-server:log", line: `[ERROR] ${line.trim()}` });
    });

    devServerProcess.on("exit", (code) => {
      console.log(`[DevServer] Exited with code ${code}`);
      devServerProcess = null;
      devServerUrl = null;
      devServerStatus = "stopped";

      // Parse buffered output for a structured error. Useful both when the
      // process dies before printing its URL (preflight didn't catch it) and
      // when Astro starts then crashes a moment later (e.g. runtime error
      // during content collection sync that survives `astro sync`).
      if (code !== 0) {
        const parsed = parseAstroError((stderrBuffer + "\n" + stdoutBuffer).trim() || `Dev server exited with code ${code}`);
        broadcast({ type: "dev-server:error", message: parsed.message, error: parsed });
        if (!resolved) {
          reject(new DevServerStartFailure(parsed));
        }
      } else {
        broadcast({ type: "dev-server:error", message: `Dev server exited with code ${code}` });
      }
    });

    devServerProcess.on("error", (err) => {
      devServerStatus = "error";
      const parsed: DevServerStartError = { kind: "unknown", message: err.message, raw: err.stack ?? err.message };
      broadcast({ type: "dev-server:error", message: err.message, error: parsed });
      if (!resolved) reject(new DevServerStartFailure(parsed));
    });

    setTimeout(() => {
      if (!devServerUrl) {
        devServerStatus = "error";
        const parsed: DevServerStartError = {
          kind: "unknown",
          message: "Dev server failed to start within 30 seconds",
          raw: stderrBuffer + "\n" + stdoutBuffer,
        };
        if (!resolved) reject(new DevServerStartFailure(parsed));
      }
    }, 30000);
  });
}

export function stopDevServer() {
  if (devServerProcess) {
    devServerProcess.kill();
    devServerProcess = null;
    devServerUrl = null;
    devServerStatus = "stopped";
  }
}
