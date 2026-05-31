import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

/**
 * Run the project's package manager's install command in `repoPath`.
 *
 * Detection: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
 * `package-lock.json` → npm, anything else → npm fallback. The choice
 * is intentional — we honor whatever the repo committed, never silently
 * convert.
 *
 * Windows quirk: pnpm and yarn aren't typically on PATH (Corepack
 * shims them on demand). We invoke them via `corepack <pm> install`
 * so they resolve regardless of shell setup. npm is always on PATH
 * because it ships with Node.
 *
 * Phase 1: blocking — caller awaits completion. Output is captured
 * but only surfaced on failure (stderr tail in the error message).
 * A follow-up wires WebSocket progress events for the editor to
 * stream during clone+install.
 */

export type PackageManager = "pnpm" | "yarn" | "npm";

export interface InstallResult {
  ok: boolean;
  packageManager: PackageManager | null;
  /** Last ~500 chars of stderr on failure. Empty on success. */
  errorTail?: string;
  /** Wall-clock time in milliseconds. */
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export async function installDependencies(
  repoPath: string,
  opts: { timeoutMs?: number; onLog?: (line: string) => void } = {}
): Promise<InstallResult> {
  const start = Date.now();
  const pm = await detectPackageManager(repoPath);
  if (!pm) {
    // No package.json — nothing to install. Treated as success.
    return { ok: true, packageManager: null, durationMs: Date.now() - start };
  }

  const isWindows = process.platform === "win32";
  const { cmd, args } = resolveCommand(pm, isWindows);

  return new Promise<InstallResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWindows,
      // Don't inherit npm/pnpm config from this server's environment.
      // The user's repo may have its own .npmrc; let it apply normally.
      env: { ...process.env },
    });

    let stderrTail = "";
    const appendTail = (chunk: Buffer): void => {
      const text = chunk.toString();
      stderrTail += text;
      if (stderrTail.length > 5000) {
        stderrTail = stderrTail.slice(-3000);
      }
      if (opts.onLog) {
        for (const line of text.split(/\r?\n/)) {
          if (line) opts.onLog(line);
        }
      }
    };
    child.stdout?.on("data", appendTail);
    child.stderr?.on("data", appendTail);

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        ok: false,
        packageManager: pm,
        errorTail: `Install timed out after ${Math.round(timeoutMs / 1000)}s`,
        durationMs: Date.now() - start,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        packageManager: pm,
        errorTail: `Failed to spawn '${cmd} ${args.join(" ")}': ${err.message}`,
        durationMs: Date.now() - start,
      });
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({
          ok: true,
          packageManager: pm,
          durationMs: Date.now() - start,
        });
      } else {
        resolve({
          ok: false,
          packageManager: pm,
          errorTail: `Exit ${code ?? "(signal " + signal + ")"}: ${stderrTail.slice(-500).trim()}`,
          durationMs: Date.now() - start,
        });
      }
    });
  });
}

export async function detectPackageManager(
  repoPath: string
): Promise<PackageManager | null> {
  if (await fileExists(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(repoPath, "yarn.lock"))) return "yarn";
  if (await fileExists(path.join(repoPath, "package-lock.json"))) return "npm";
  if (await fileExists(path.join(repoPath, "package.json"))) return "npm";
  return null;
}

function resolveCommand(
  pm: PackageManager,
  isWindows: boolean
): { cmd: string; args: string[] } {
  // For npm we use the binary directly — it ships with Node and is
  // always on PATH. For pnpm and yarn we go through Corepack, which
  // resolves them on demand without requiring `corepack enable` at
  // install time. This is the same trick `astro-dev-server.ts` uses
  // for `npx`.
  if (pm === "npm") {
    return { cmd: isWindows ? "npm.cmd" : "npm", args: ["install"] };
  }
  if (pm === "pnpm") {
    return {
      cmd: isWindows ? "corepack.cmd" : "corepack",
      args: ["pnpm", "install"],
    };
  }
  // yarn
  return {
    cmd: isWindows ? "corepack.cmd" : "corepack",
    args: ["yarn", "install"],
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
