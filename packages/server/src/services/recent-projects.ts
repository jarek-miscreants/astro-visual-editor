import fs from "fs/promises";
import os from "os";
import path from "path";
import type { StateStore } from "./state-store.js";

/**
 * Recent-projects accessor. Originally a thin wrapper around
 * `~/.tve-recent.json` (CLI mode); Phase 1 adds dual-write to the
 * SQLite state store so the desktop flow has a typed source of truth.
 *
 * - In `cli` mode (legacy default), writes go to JSON. If a state store
 *   is attached, writes also land in SQLite for forward compatibility;
 *   reads merge SQLite-first then JSON.
 * - In `desktop` mode, writes are SQLite-only and reads come from SQLite.
 *
 * The state store is attached at server boot via `attachStateStore`.
 * If no store is attached, the module behaves exactly as before.
 */

const FILE = path.join(os.homedir(), ".tve-recent.json");
const MAX = 10;

interface RecentFile {
  projects: string[];
}

let injected: { store: StateStore; mode: "cli" | "desktop" } | null = null;

export function attachStateStore(
  store: StateStore,
  mode: "cli" | "desktop"
): void {
  injected = { store, mode };
}

export function detachStateStore(): void {
  injected = null;
}

async function readJson(): Promise<string[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const data = JSON.parse(raw) as RecentFile;
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

async function writeJson(projects: string[]): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify({ projects }, null, 2), "utf-8");
}

async function filterToExistingDirs(paths: string[]): Promise<string[]> {
  const valid: string[] = [];
  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) valid.push(p);
    } catch {
      // Skip missing paths
    }
  }
  return valid;
}

export async function getRecentProjects(): Promise<string[]> {
  if (injected) {
    const sqliteRows = injected.store.listRecentProjects();
    const sqlitePaths = sqliteRows.map((r) => r.path);

    if (injected.mode === "desktop") {
      return filterToExistingDirs(sqlitePaths);
    }

    // cli mode: union, SQLite-first
    const jsonPaths = await readJson();
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const p of [...sqlitePaths, ...jsonPaths]) {
      if (seen.has(p)) continue;
      seen.add(p);
      merged.push(p);
    }
    return filterToExistingDirs(merged);
  }

  // No store attached — legacy JSON behavior
  return filterToExistingDirs(await readJson());
}

export async function addRecentProject(projectPath: string): Promise<void> {
  if (injected) {
    injected.store.addRecentProject(projectPath, path.basename(projectPath));
    if (injected.mode === "cli") {
      const existing = await readJson();
      const filtered = existing.filter((p) => p !== projectPath);
      filtered.unshift(projectPath);
      await writeJson(filtered.slice(0, MAX));
    }
    return;
  }

  // No store attached — legacy JSON behavior
  const existing = await readJson();
  const filtered = existing.filter((p) => p !== projectPath);
  filtered.unshift(projectPath);
  await writeJson(filtered.slice(0, MAX));
}
