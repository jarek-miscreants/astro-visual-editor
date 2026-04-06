import { spawn, type ChildProcess } from "child_process";
import type { DevServerStatus } from "@tve/shared";

let devServerProcess: ChildProcess | null = null;
let devServerUrl: string | null = null;
let devServerStatus: DevServerStatus = "stopped";

export function getDevServerStatus() {
  return { status: devServerStatus, url: devServerUrl };
}

export function startDevServer(
  projectPath: string,
  broadcast: (message: object) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (devServerProcess) {
      if (devServerUrl) {
        resolve(devServerUrl);
        return;
      }
      reject(new Error("Dev server is already starting"));
      return;
    }

    devServerStatus = "starting";
    console.log("[DevServer] Starting Astro dev server...");

    // Use npx to run astro dev
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "npx.cmd" : "npx";
    devServerProcess = spawn(cmd, ["astro", "dev", "--port", "4321"], {
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWindows,
    });

    devServerProcess.stdout?.on("data", (data: Buffer) => {
      const line = data.toString();
      console.log(`[DevServer] ${line.trim()}`);

      broadcast({ type: "dev-server:log", line: line.trim() });

      // Detect when the server is ready
      const urlMatch = line.match(/http:\/\/localhost:\d+/);
      if (urlMatch && !devServerUrl) {
        devServerUrl = urlMatch[0];
        devServerStatus = "running";
        console.log(`[DevServer] Ready at ${devServerUrl}`);
        broadcast({ type: "dev-server:ready", url: devServerUrl });
        resolve(devServerUrl);
      }
    });

    devServerProcess.stderr?.on("data", (data: Buffer) => {
      const line = data.toString();
      console.error(`[DevServer Error] ${line.trim()}`);
      broadcast({ type: "dev-server:log", line: `[ERROR] ${line.trim()}` });
    });

    devServerProcess.on("exit", (code) => {
      console.log(`[DevServer] Exited with code ${code}`);
      devServerProcess = null;
      devServerUrl = null;
      devServerStatus = "stopped";
      broadcast({ type: "dev-server:error", message: `Dev server exited with code ${code}` });
    });

    devServerProcess.on("error", (err) => {
      devServerStatus = "error";
      broadcast({ type: "dev-server:error", message: err.message });
      reject(err);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!devServerUrl) {
        devServerStatus = "error";
        reject(new Error("Dev server failed to start within 30 seconds"));
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
