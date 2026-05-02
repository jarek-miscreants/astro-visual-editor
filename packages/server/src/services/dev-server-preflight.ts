import { spawn } from "child_process";
import type { DevServerStartError } from "@tve/shared";

/** Strip ANSI escape codes so regexes match raw text. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Parse Astro CLI error output into a structured DevServerStartError.
 *  Falls back to { kind: "unknown" } when the shape isn't recognised. */
export function parseAstroError(rawInput: string): DevServerStartError {
  const raw = stripAnsi(rawInput);

  // InvalidContentEntryDataError — collection schema mismatch
  const schema = raw.match(
    /InvalidContentEntryDataError\]?\s*([^\n→]+?)\s*→\s*([^\s]+)\s*data does not match collection schema/i
  );
  if (schema) {
    const collection = schema[1].trim();
    const entry = schema[2].trim();
    const file = raw.match(/Location:\s*\n?\s*([^\n]+)/)?.[1]?.trim();
    // Each "<field>: Required" line = a missing field. Names appear duplicated
    // in chalk-bolded output ("question**: **question: Required") — collapse.
    const fieldMatches = [...raw.matchAll(/^\s*([A-Za-z0-9_]+)\*?\*?:?\s*\*?\*?\1?\s*:\s*Required\s*$/gm)];
    const missingFields = [...new Set(fieldMatches.map((m) => m[1]))];
    return {
      kind: "schema",
      message: `${collection} → ${entry}: missing required field${missingFields.length === 1 ? "" : "s"} ${missingFields.join(", ")}`,
      collection,
      entry,
      file: file?.replace(/:\d+:\d+$/, ""),
      missingFields,
      raw,
    };
  }

  // Port already in use
  const port = raw.match(/Port (\d+) is in use|EADDRINUSE.*?:(\d+)/);
  if (port) {
    const p = Number(port[1] ?? port[2]);
    return {
      kind: "port",
      message: `Port ${p} is already in use`,
      port: p,
      raw,
    };
  }

  // Missing package / module
  const dep = raw.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/);
  if (dep) {
    return {
      kind: "missing-dep",
      message: `Missing dependency: ${dep[1]}`,
      dep: dep[1],
      raw,
    };
  }

  // Astro config errors
  if (/Failed to load (?:astro\.config|configuration)/i.test(raw) || /AstroConfig(?:Error)?/i.test(raw)) {
    const file = raw.match(/(astro\.config\.[mc]?[jt]s)/i)?.[1];
    const firstLine = raw.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "Astro config error";
    return {
      kind: "config",
      message: firstLine.slice(0, 200),
      file,
      raw,
    };
  }

  // Astro syntax / parse errors
  const syntax = raw.match(/(?:Parse|Syntax|Compiler)\s*Error[^\n]*\n[\s\S]*?Location:\s*\n?\s*([^\n]+)/i);
  if (syntax) {
    const loc = syntax[1].trim();
    const [file, line] = loc.split(":");
    return {
      kind: "syntax",
      message: raw.split("\n")[0].trim().slice(0, 200),
      file,
      line: line ? Number(line) : undefined,
      raw,
    };
  }

  // Last-ditch: surface the first non-empty line as the message
  const firstLine = raw.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "Astro failed to start";
  return { kind: "unknown", message: firstLine.slice(0, 200), raw };
}

/** Run `astro sync` against the project as a fast preflight before spawning
 *  `astro dev`. Catches content-collection schema errors and astro.config
 *  failures synchronously so the editor can show a structured error instead
 *  of a generic "Failed to start". Returns null on success. */
export function runDevServerPreflight(projectPath: string): Promise<DevServerStartError | null> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "npx.cmd" : "npx";
    const child = spawn(cmd, ["astro", "sync"], {
      cwd: projectPath,
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWindows,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });

    const settle = (code: number | null) => {
      if (code === 0) {
        resolve(null);
        return;
      }
      const combined = (stderr + "\n" + stdout).trim();
      const parsed = parseAstroError(combined || `astro sync exited with code ${code}`);
      // Only block on errors we can confidently classify. If `astro sync`
      // exits non-zero with output we don't recognise (e.g. the libuv
      // UV_HANDLE_CLOSING assertion that astro sync sometimes hits on
      // Windows even when the project itself is healthy), treat preflight
      // as inconclusive and let `astro dev` decide. The dev-server spawn
      // captures its own stderr and parses it on exit, so genuine failures
      // are still surfaced — we just don't refuse to start on a noisy sync.
      if (parsed.kind === "unknown") {
        console.warn(`[Preflight] astro sync exited ${code} but error wasn't classifiable; proceeding anyway. Output: ${combined.slice(0, 200)}`);
        resolve(null);
        return;
      }
      resolve(parsed);
    };

    child.on("exit", settle);
    child.on("error", (err) => {
      // Likely npx/astro not installed. Don't block — let `astro dev` run
      // and report its own error if there's a real problem.
      console.warn(`[Preflight] failed to spawn astro sync: ${err.message}; proceeding anyway`);
      resolve(null);
    });

    // 20s ceiling — sync should be much faster, but bail rather than hang.
    // A timeout is inconclusive, not a failure, so let dev start.
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        console.warn("[Preflight] astro sync timed out after 20s; proceeding anyway");
        resolve(null);
      }
    }, 20000);
  });
}
