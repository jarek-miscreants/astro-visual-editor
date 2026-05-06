import fs from "fs/promises";
import path from "path";
import { detectTailwindVersion } from "./tailwind-config.js";

/**
 * Single source of truth for "is this an Astro + Tailwind project that
 * TVE can edit?" Used by `POST /api/project/switch` (local mode) and
 * — once Phase 2 wires the GitHub picker — by the remote pre-clone
 * probe. Both code paths funnel through the same validator so the
 * "incompatible project" rule stays identical regardless of source.
 */

export type ValidationFailureReason =
  | "no-astro-config"
  | "no-tailwind"
  | "unsupported-tailwind"
  | "too-large"
  | "symlink-escape";

export type ValidationResult =
  | { ok: true; tailwindVersion: 3 | 4 }
  | { ok: false; reason: ValidationFailureReason; detail: string };

const ASTRO_CONFIG_CANDIDATES = [
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.mts",
  "astro.config.cjs",
];

const TAILWIND_V3_CONFIGS = [
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.cjs",
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".astro",
  "dist",
  "build",
  ".next",
  ".vercel",
  ".netlify",
]);

/** Recursive CSS search depth cap. Tailwind v4 stylesheets normally
 *  live in `src/styles/` or `src/`; allowing 3 levels covers
 *  `src/assets/styles/` without scanning the whole tree. */
const CSS_SEARCH_MAX_DEPTH = 3;

/** Symlink-escape walk depth. Mirrors the recursive CSS search but
 *  cheaper — only checks symlinks, not file contents. */
const SYMLINK_WALK_MAX_DEPTH = 5;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function hasAstroConfig(dir: string): Promise<string | null> {
  for (const name of ASTRO_CONFIG_CANDIDATES) {
    if (await fileExists(path.join(dir, name))) return name;
  }
  return null;
}

async function hasTailwindV3Config(dir: string): Promise<boolean> {
  for (const name of TAILWIND_V3_CONFIGS) {
    if (await fileExists(path.join(dir, name))) return true;
  }
  return false;
}

/** Walk the repo for any CSS file containing v4 Tailwind markers.
 *  Capped at `CSS_SEARCH_MAX_DEPTH`, skipping the usual heavy dirs.
 *  Returns the first match found (string) or null. */
async function findV4Stylesheet(dir: string): Promise<string | null> {
  return walkForV4(dir, dir, 0);
}

async function walkForV4(
  current: string,
  root: string,
  depth: number
): Promise<string | null> {
  if (depth > CSS_SEARCH_MAX_DEPTH) return null;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const found = await walkForV4(path.join(current, entry.name), root, depth + 1);
      if (found) return found;
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".css")) continue;
    const full = path.join(current, entry.name);
    let content: string;
    try {
      content = await fs.readFile(full, "utf-8");
    } catch {
      continue;
    }
    if (
      content.includes("@theme") ||
      content.includes('@import "tailwindcss"') ||
      content.includes("@import 'tailwindcss'")
    ) {
      return full;
    }
  }
  return null;
}

/** Defense-in-depth check on top of `lib/path-guard.ts`. Detects
 *  symlinks under `dir` whose realpath escapes `dir`. We don't trust
 *  the user-supplied directory here because Phase 2 will hand us
 *  paths from `~/.tve/repos/{owner}/{name}/` after `git clone`, and a
 *  malicious repo could ship symlinks pointing at `~/.ssh` etc. */
async function detectSymlinkEscape(dir: string): Promise<string | null> {
  const realRoot = await fs.realpath(dir);
  return walkForEscape(dir, realRoot, 0);
}

async function walkForEscape(
  current: string,
  realRoot: string,
  depth: number
): Promise<string | null> {
  if (depth > SYMLINK_WALK_MAX_DEPTH) return null;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      let resolved: string;
      try {
        resolved = await fs.realpath(full);
      } catch {
        // Broken symlinks aren't an escape — they just don't resolve.
        continue;
      }
      const rel = path.relative(realRoot, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return full;
      }
      continue;
    }
    if (entry.isDirectory()) {
      const found = await walkForEscape(full, realRoot, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Validate a local project directory. Single source of truth for
 * "TVE can edit this" — the `/api/project/switch` route consumes it.
 *
 * Algorithm:
 *   1. Symlink-escape walk (depth 5).
 *   2. Astro config at root (any of the 5 extensions).
 *   3. Tailwind detection: v3 config OR v4 CSS marker (depth 3).
 *
 * Returns `{ ok: false, reason, detail }` on the first failing step.
 */
export async function validateLocalProject(dir: string): Promise<ValidationResult> {
  const escape = await detectSymlinkEscape(dir);
  if (escape) {
    return {
      ok: false,
      reason: "symlink-escape",
      detail: `Symlink escapes project root: ${path.relative(dir, escape) || escape}`,
    };
  }

  const astroConfig = await hasAstroConfig(dir);
  if (!astroConfig) {
    return {
      ok: false,
      reason: "no-astro-config",
      detail: `No astro.config.{mjs,ts,js,mts,cjs} found in ${dir}`,
    };
  }

  // Fast path: tailwind-config's existing detector covers the common
  // entry-file paths first. Falls through to a recursive search only
  // if the detector returns no concrete file.
  const detected = await detectTailwindVersion(dir);
  if (detected.cssPath) {
    return { ok: true, tailwindVersion: 4 };
  }
  if (detected.configPath) {
    return { ok: true, tailwindVersion: 3 };
  }

  if (await hasTailwindV3Config(dir)) {
    return { ok: true, tailwindVersion: 3 };
  }

  const v4Css = await findV4Stylesheet(dir);
  if (v4Css) {
    return { ok: true, tailwindVersion: 4 };
  }

  return {
    ok: false,
    reason: "no-tailwind",
    detail: "Project has astro.config but no Tailwind v3 config or v4 CSS @theme/import",
  };
}

/**
 * Validate a remote repo via the GitHub Contents API before cloning.
 * Mirrors `validateLocalProject` but probes via HTTP — used by Phase 2
 * step 12's pre-clone API probe to grey out incompatible repos in the
 * picker without touching disk.
 *
 * Phase 1 ships this function and its tests; the Phase 2 picker route
 * just wires it up.
 */
export interface RemoteProbeOptions {
  owner: string;
  repo: string;
  ref?: string;
  /** GitHub installation token (Phase 2 supplies via TokenStore). */
  token?: string;
  /** Hard cap from the repo metadata `size` field (KB). Default 500MB. */
  maxSizeKb?: number;
  /** Repo size in KB from `GET /repos/{owner}/{repo}` — caller supplies
   *  to keep this function pure (one less API call to mock). */
  sizeKb?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_SIZE_KB = 500 * 1024;

export async function validateRemoteRepo(
  opts: RemoteProbeOptions
): Promise<ValidationResult> {
  const { owner, repo, ref, token, sizeKb } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxSizeKb = opts.maxSizeKb ?? DEFAULT_MAX_SIZE_KB;

  if (typeof sizeKb === "number" && sizeKb > maxSizeKb) {
    return {
      ok: false,
      reason: "too-large",
      detail: `Repo is ${Math.round(sizeKb / 1024)} MB; cap is ${Math.round(maxSizeKb / 1024)} MB`,
    };
  }

  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const rootEntries = await fetchContents(
    fetchImpl,
    `https://api.github.com/repos/${owner}/${repo}/contents${refQuery}`,
    headers
  );
  if (!rootEntries) {
    return {
      ok: false,
      reason: "no-astro-config",
      detail: `Could not list contents of ${owner}/${repo}${ref ? `@${ref}` : ""}`,
    };
  }

  const rootNames = new Set(rootEntries.filter((e) => e.type === "file").map((e) => e.name));
  const hasAstro = ASTRO_CONFIG_CANDIDATES.some((n) => rootNames.has(n));
  if (!hasAstro) {
    return {
      ok: false,
      reason: "no-astro-config",
      detail: `No astro.config.{mjs,ts,js,mts,cjs} at repo root`,
    };
  }

  if (TAILWIND_V3_CONFIGS.some((n) => rootNames.has(n))) {
    return { ok: true, tailwindVersion: 3 };
  }

  // Look for a v4 CSS file via recursive Contents API calls, capped.
  const v4 = await probeForV4Css(fetchImpl, owner, repo, ref, headers, rootEntries, 0);
  if (v4) return { ok: true, tailwindVersion: 4 };

  return {
    ok: false,
    reason: "no-tailwind",
    detail: "Repo has astro.config but no Tailwind v3 config or v4 CSS marker",
  };
}

interface ContentsEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  path: string;
}

async function fetchContents(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>
): Promise<ContentsEntry[] | null> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) return null;
  return data as ContentsEntry[];
}

async function probeForV4Css(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  ref: string | undefined,
  headers: Record<string, string>,
  entries: ContentsEntry[],
  depth: number
): Promise<boolean> {
  if (depth > CSS_SEARCH_MAX_DEPTH) return false;
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";

  for (const entry of entries) {
    if (entry.type === "file" && entry.name.endsWith(".css")) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? "HEAD"}/${entry.path}`;
      let res: Response;
      try {
        res = await fetchImpl(rawUrl, { headers });
      } catch {
        continue;
      }
      if (!res.ok) continue;
      const content = await res.text().catch(() => "");
      if (
        content.includes("@theme") ||
        content.includes('@import "tailwindcss"') ||
        content.includes("@import 'tailwindcss'")
      ) {
        return true;
      }
    }
  }

  for (const entry of entries) {
    if (entry.type !== "dir") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const subUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${entry.path}${refQuery}`;
    const sub = await fetchContents(fetchImpl, subUrl, headers);
    if (!sub) continue;
    const found = await probeForV4Css(fetchImpl, owner, repo, ref, headers, sub, depth + 1);
    if (found) return true;
  }
  return false;
}
