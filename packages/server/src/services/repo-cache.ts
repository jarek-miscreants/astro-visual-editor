import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { StateStore } from "./state-store.js";
import { tveReposBaseDir } from "./tve-paths.js";

/**
 * Filesystem layout + bookkeeping for cached repo clones.
 *
 *   {base}/{owner}/{repo}/
 *     .tve-meta.json          { lockHash, installedAt, lastUsedAt }
 *     <full repo checkout>
 *
 * Phase 1 only ships the data model — Phase 2 wires it into the clone
 * route. The cache exposes path resolution, lockfile-hash bookkeeping
 * (so we can skip `pnpm install` when the lockfile hasn't changed),
 * and a defensive symlink check that mirrors `project-validator.ts`'s
 * symlink-escape detection.
 *
 * Resolution precedence for `resolveBaseDir`:
 *   1. Explicit `override` argument (clone-time per-repo override).
 *   2. `prefs.repos_base_dir` in state.db (sticky user preference).
 *   3. Default `~/.tve/repos/` (resolves via tveReposBaseDir()).
 */

export interface RepoCacheEntry {
  owner: string;
  repo: string;
  path: string;
  /** SHA-256 of pnpm-lock.yaml | package-lock.json | yarn.lock (whichever
   *  exists, in that priority order). Null if no lockfile. */
  lockHash: string | null;
  /** Last time `pnpm install` (or equivalent) finished successfully. */
  installedAt: number | null;
  lastUsedAt: number;
  /** GitHub App installation_id this clone was sourced from. Set
   *  when `cloneFromGithub` records it post-clone; null for local
   *  projects that weren't opened via the GitHub picker. The
   *  token-injecting git transport uses it to mint per-call
   *  installation tokens for push/pull. */
  installationId: number | null;
}

export interface RepoCache {
  resolveBaseDir(override?: string): Promise<string>;
  resolvePath(base: string, owner: string, repo: string): string;
  exists(absPath: string): Promise<boolean>;
  read(absPath: string): Promise<RepoCacheEntry | null>;
  ensureDir(absPath: string): Promise<void>;
  /** Recompute and persist `lockHash` + `installedAt`. Called after a
   *  successful clone or `git pull` + `pnpm install`. */
  recordLockHash(absPath: string): Promise<string | null>;
  /** Persist the installation_id this clone was sourced from. Called
   *  by `cloneFromGithub` after the install step. */
  recordInstallation(absPath: string, installationId: number): Promise<void>;
  /** True when the on-disk lockfile differs from the persisted hash —
   *  i.e. the caller needs to run `pnpm install` again before booting
   *  the dev server. Also true when no lockfile exists at all. */
  needsInstall(absPath: string): Promise<boolean>;
  remove(absPath: string): Promise<void>;
}

const META_FILE = ".tve-meta.json";

const LOCKFILE_PRIORITY = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
];

interface MetaShape {
  owner?: string;
  repo?: string;
  lockHash?: string | null;
  installedAt?: number | null;
  lastUsedAt?: number;
  installationId?: number | null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(absPath: string): Promise<MetaShape | null> {
  try {
    const raw = await fs.readFile(path.join(absPath, META_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as MetaShape;
  } catch {
    return null;
  }
}

async function writeMeta(absPath: string, meta: MetaShape): Promise<void> {
  await fs.mkdir(absPath, { recursive: true });
  await fs.writeFile(
    path.join(absPath, META_FILE),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );
}

async function hashLockfile(absPath: string): Promise<string | null> {
  for (const name of LOCKFILE_PRIORITY) {
    const p = path.join(absPath, name);
    if (!(await fileExists(p))) continue;
    const buf = await fs.readFile(p);
    const h = crypto.createHash("sha256");
    h.update(buf);
    return h.digest("hex");
  }
  return null;
}

/** Defense-in-depth check: refuse to operate on a path whose realpath
 *  escapes its claimed parent. Mirrors the symlink check in
 *  `project-validator.ts` but at the cache layer — primary path-guard
 *  is `lib/path-guard.ts` in Phase 2. */
async function ensurePathInsideBase(
  base: string,
  absPath: string
): Promise<void> {
  let realBase: string;
  try {
    realBase = await fs.realpath(base);
  } catch {
    // Base doesn't exist yet — nothing to check.
    return;
  }
  let realPath: string;
  try {
    realPath = await fs.realpath(absPath);
  } catch {
    // Target doesn't exist yet — nothing to check.
    return;
  }
  const rel = path.relative(realBase, realPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Cache path '${absPath}' resolves outside its base '${base}' — refusing to operate on a symlink-escape`
    );
  }
}

export function createRepoCache(stateStore: StateStore): RepoCache {
  async function resolveBaseDir(override?: string): Promise<string> {
    if (override && override.trim().length > 0) {
      return path.resolve(override);
    }
    const pref = stateStore.getPref<string>("repos_base_dir");
    if (pref && pref.trim().length > 0) {
      return path.resolve(pref);
    }
    return tveReposBaseDir();
  }

  function resolvePath(base: string, owner: string, repo: string): string {
    if (!owner || !repo) {
      throw new Error("resolvePath requires non-empty owner and repo");
    }
    // GitHub username: 1–39 chars, alphanumeric or single internal
    // hyphens, no leading/trailing/consecutive hyphens.
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(owner)) {
      throw new Error(`Invalid owner '${owner}'`);
    }
    // GitHub repo: alphanumeric, dot, underscore, hyphen, ≤100 chars.
    // Explicitly reject `.`/`..` (path traversal) which the charset
    // alone would otherwise allow.
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
      throw new Error(`Invalid repo '${repo}'`);
    }
    // Windows reserved device names (case-insensitive, with/without an
    // extension) can't be used as directory names.
    const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
    if (WIN_RESERVED.test(owner) || WIN_RESERVED.test(repo)) {
      throw new Error(`'${owner}/${repo}' uses a reserved device name`);
    }
    const resolvedBase = path.resolve(base);
    const full = path.resolve(path.join(resolvedBase, owner, repo));
    // Defense in depth: after resolution, the result must still sit
    // inside the base. Throws if owner/repo somehow escaped the join.
    if (full !== resolvedBase && !full.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Resolved path '${full}' escapes base '${resolvedBase}'`);
    }
    return full;
  }

  async function exists(absPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(absPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async function read(absPath: string): Promise<RepoCacheEntry | null> {
    if (!(await exists(absPath))) return null;
    const meta = await readMeta(absPath);
    if (!meta) return null;
    // owner/repo derive from the path: {.../owner/repo}
    const repo = path.basename(absPath);
    const owner = path.basename(path.dirname(absPath));
    return {
      owner: meta.owner ?? owner,
      repo: meta.repo ?? repo,
      path: absPath,
      lockHash: meta.lockHash ?? null,
      installedAt: meta.installedAt ?? null,
      lastUsedAt: meta.lastUsedAt ?? Date.now(),
      installationId: meta.installationId ?? null,
    };
  }

  async function ensureDir(absPath: string): Promise<void> {
    const parent = path.dirname(absPath);
    await fs.mkdir(parent, { recursive: true });
    await ensurePathInsideBase(parent, absPath).catch(() => {});
    await fs.mkdir(absPath, { recursive: true });
    // Seed an empty meta file so subsequent `read` returns a record
    // (even before the first lockfile hash is computed).
    const existing = await readMeta(absPath);
    if (!existing) {
      const repo = path.basename(absPath);
      const owner = path.basename(path.dirname(absPath));
      await writeMeta(absPath, {
        owner,
        repo,
        lockHash: null,
        installedAt: null,
        lastUsedAt: Date.now(),
      });
    }
  }

  async function recordLockHash(absPath: string): Promise<string | null> {
    if (!(await exists(absPath))) {
      throw new Error(`recordLockHash: cache directory '${absPath}' does not exist`);
    }
    const hash = await hashLockfile(absPath);
    const existing = (await readMeta(absPath)) ?? {};
    await writeMeta(absPath, {
      ...existing,
      lockHash: hash,
      installedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    return hash;
  }

  async function recordInstallation(
    absPath: string,
    installationId: number
  ): Promise<void> {
    if (!(await exists(absPath))) {
      throw new Error(
        `recordInstallation: cache directory '${absPath}' does not exist`
      );
    }
    const existing = (await readMeta(absPath)) ?? {};
    await writeMeta(absPath, {
      ...existing,
      installationId,
      lastUsedAt: Date.now(),
    });
  }

  async function needsInstall(absPath: string): Promise<boolean> {
    if (!(await exists(absPath))) return true;
    const current = await hashLockfile(absPath);
    if (current === null) {
      // No lockfile — caller must always run install (idempotent for the
      // common "fresh clone, no lockfile yet" path).
      return true;
    }
    const meta = await readMeta(absPath);
    if (!meta || meta.lockHash !== current) return true;
    return false;
  }

  async function remove(absPath: string): Promise<void> {
    await fs.rm(absPath, { recursive: true, force: true });
  }

  return {
    resolveBaseDir,
    resolvePath,
    exists,
    read,
    ensureDir,
    recordLockHash,
    recordInstallation,
    needsInstall,
    remove,
  };
}
