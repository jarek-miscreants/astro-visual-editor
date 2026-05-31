import Database from "better-sqlite3";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { migrate } from "./state-store-migrations.js";
import { tveHome, tveStateDbPath } from "./tve-paths.js";

/**
 * Persistent state for TVE — auth identities, installation/repo
 * metadata, user prefs, and recent projects. Lives at
 * `~/.tve/state.db` (overridable via `TVE_HOME`).
 *
 * Phase 1: opens cleanly in both `cli` and `desktop` modes. Auth/repo
 * write paths exist but only have callers in `desktop` mode (Phase 2+).
 * Recent projects + prefs are exercised by `cli` flows.
 */

export interface GithubAccount {
  /** Local primary key. Use this as the FK target for installations. */
  id: number;
  login: string;
  /** GitHub's user ID — globally unique, survives username changes. */
  githubId: number;
  avatarUrl: string | null;
  addedAt: number;
}

export interface Installation {
  /** GitHub installation_id (used as the local PK directly). */
  id: number;
  accountId: number;
  accountLogin: string;
  addedAt: number;
}

export interface RepoRecord {
  id: number;
  installationId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  fsPath: string;
  lastOpenedAt: number | null;
}

export interface RecentProjectRow {
  path: string;
  name: string;
}

export interface StateStore {
  open(): Promise<void>;
  close(): void;

  // Auth/repo metadata — Phase 2+ consumers
  upsertAccount(input: {
    login: string;
    githubId: number;
    avatarUrl?: string;
  }): GithubAccount;
  listInstallations(): Installation[];
  upsertInstallation(input: { id: number; accountLogin: string }): Installation;
  listRepos(installationId: number): RepoRecord[];
  upsertRepo(input: {
    installationId: number;
    owner: string;
    name: string;
    defaultBranch: string;
    fsPath: string;
  }): RepoRecord;
  touchRepoOpened(owner: string, name: string): void;

  // Prefs (used in both cli + desktop)
  getPref<T>(key: string): T | null;
  setPref<T>(key: string, value: T): void;

  // Recent projects (parity with services/recent-projects.ts)
  listRecentProjects(): RecentProjectRow[];
  addRecentProject(projectPath: string, name: string): void;

  /**
   * Reconcile the persisted GitHub App ID with the one this server
   * boot is configured for. On a change (or first boot with auth
   * configured), drops every app-bound row — `installations`,
   * `repos` — so stale installation IDs from the old App can't leak
   * into the new App's flows. `prefs`, `recent_projects`, and
   * `github_account` survive (the user's identity isn't App-bound;
   * upsertAccount on next sign-in is idempotent).
   *
   * Returns `previousAppId: null` on first boot. `changed: false`
   * means no-op.
   */
  syncAppContext(currentAppId: number): {
    changed: boolean;
    previousAppId: number | null;
  };
}

export interface CreateStateStoreOptions {
  /** Override the database file path. Defaults to `tveStateDbPath()`. */
  dbPath?: string;
  /** Legacy JSON files to one-shot import on first open. Defaults
   *  cover both `~/.tve-recent.json` (existing real path) and
   *  `~/.tve/recent-projects.json` (plan-anticipated path). Tests
   *  override to a tmp path. */
  legacyJsonPaths?: string[];
}

function defaultLegacyJsonPaths(): string[] {
  return [
    path.join(os.homedir(), ".tve-recent.json"),
    path.join(tveHome(), "recent-projects.json"),
  ];
}

interface AccountRow {
  id: number;
  login: string;
  github_id: number;
  avatar_url: string | null;
  added_at: number;
}

interface InstallationRow {
  id: number;
  account_id: number;
  account_login: string;
  added_at: number;
}

interface RepoRow {
  id: number;
  installation_id: number;
  owner: string;
  name: string;
  default_branch: string;
  fs_path: string;
  last_opened_at: number | null;
}

function rowToAccount(r: AccountRow): GithubAccount {
  return {
    id: r.id,
    login: r.login,
    githubId: r.github_id,
    avatarUrl: r.avatar_url,
    addedAt: r.added_at,
  };
}

function rowToInstallation(r: InstallationRow): Installation {
  return {
    id: r.id,
    accountId: r.account_id,
    accountLogin: r.account_login,
    addedAt: r.added_at,
  };
}

function rowToRepo(r: RepoRow): RepoRecord {
  return {
    id: r.id,
    installationId: r.installation_id,
    owner: r.owner,
    name: r.name,
    defaultBranch: r.default_branch,
    fsPath: r.fs_path,
    lastOpenedAt: r.last_opened_at,
  };
}

export function createStateStore(
  opts: CreateStateStoreOptions = {}
): StateStore {
  let db: Database.Database | null = null;
  const dbPath = opts.dbPath ?? tveStateDbPath();
  const legacyJsonPaths = opts.legacyJsonPaths ?? defaultLegacyJsonPaths();

  function require_db(): Database.Database {
    if (!db) {
      throw new Error("StateStore not opened — call open() first");
    }
    return db;
  }

  async function open(): Promise<void> {
    if (db) return; // idempotent
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const handle = new Database(dbPath);
    handle.pragma("journal_mode = WAL");
    handle.pragma("foreign_keys = ON");
    migrate(handle);
    db = handle;
    await maybeImportLegacyRecentProjects();
  }

  function close(): void {
    if (db) {
      db.close();
      db = null;
    }
  }

  async function maybeImportLegacyRecentProjects(): Promise<void> {
    const handle = require_db();
    const count = (handle
      .prepare(`SELECT COUNT(*) AS c FROM recent_projects`)
      .get() as { c: number }).c;
    if (count > 0) return;

    for (const jsonPath of legacyJsonPaths) {
      const imported = await tryImportJson(handle, jsonPath);
      if (imported > 0) return; // first non-empty source wins
    }
  }

  async function tryImportJson(
    handle: Database.Database,
    jsonPath: string
  ): Promise<number> {
    let raw: string;
    let stat: import("fs").Stats;
    try {
      raw = await fs.readFile(jsonPath, "utf-8");
      stat = await fs.stat(jsonPath);
    } catch {
      return 0;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 0;
    }
    // Accept two shapes:
    //   - existing `~/.tve-recent.json`: `{ projects: string[] }`
    //   - hypothetical structured form:  `{ projects: { path, name?, lastOpenedAt? }[] }`
    const entries = extractEntries(parsed, stat.mtimeMs);
    if (entries.length === 0) return 0;

    const insert = handle.prepare(
      `INSERT OR IGNORE INTO recent_projects (path, name, last_opened_at) VALUES (?, ?, ?)`
    );
    const tx = handle.transaction((rows: typeof entries) => {
      for (const row of rows) {
        insert.run(row.path, row.name, row.lastOpenedAt);
      }
    });
    tx(entries);
    return entries.length;
  }

  function extractEntries(
    parsed: unknown,
    fileMtimeMs: number
  ): { path: string; name: string; lastOpenedAt: number }[] {
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projects" in parsed)
    ) {
      return [];
    }
    const projects = (parsed as { projects: unknown }).projects;
    if (!Array.isArray(projects)) return [];

    const out: { path: string; name: string; lastOpenedAt: number }[] = [];
    for (const entry of projects) {
      if (typeof entry === "string") {
        out.push({
          path: entry,
          name: path.basename(entry),
          lastOpenedAt: Math.floor(fileMtimeMs),
        });
        continue;
      }
      if (
        typeof entry === "object" &&
        entry !== null &&
        "path" in entry &&
        typeof (entry as { path: unknown }).path === "string"
      ) {
        const e = entry as {
          path: string;
          name?: unknown;
          lastOpenedAt?: unknown;
        };
        out.push({
          path: e.path,
          name:
            typeof e.name === "string" && e.name.length > 0
              ? e.name
              : path.basename(e.path),
          lastOpenedAt:
            typeof e.lastOpenedAt === "number"
              ? e.lastOpenedAt
              : Math.floor(fileMtimeMs),
        });
      }
    }
    return out;
  }

  function upsertAccount(input: {
    login: string;
    githubId: number;
    avatarUrl?: string;
  }): GithubAccount {
    const handle = require_db();
    const now = Date.now();
    const existing = handle
      .prepare(`SELECT * FROM github_account WHERE github_id = ?`)
      .get(input.githubId) as AccountRow | undefined;
    if (existing) {
      handle
        .prepare(
          `UPDATE github_account SET login = ?, avatar_url = ? WHERE id = ?`
        )
        .run(input.login, input.avatarUrl ?? null, existing.id);
      const updated = handle
        .prepare(`SELECT * FROM github_account WHERE id = ?`)
        .get(existing.id) as AccountRow;
      return rowToAccount(updated);
    }
    const result = handle
      .prepare(
        `INSERT INTO github_account (login, github_id, avatar_url, added_at) VALUES (?, ?, ?, ?)`
      )
      .run(input.login, input.githubId, input.avatarUrl ?? null, now);
    const created = handle
      .prepare(`SELECT * FROM github_account WHERE id = ?`)
      .get(result.lastInsertRowid) as AccountRow;
    return rowToAccount(created);
  }

  function listInstallations(): Installation[] {
    const handle = require_db();
    const rows = handle
      .prepare(`SELECT * FROM installations ORDER BY added_at DESC`)
      .all() as InstallationRow[];
    return rows.map(rowToInstallation);
  }

  function upsertInstallation(input: {
    id: number;
    accountLogin: string;
  }): Installation {
    const handle = require_db();
    const account = handle
      .prepare(`SELECT id FROM github_account WHERE login = ?`)
      .get(input.accountLogin) as { id: number } | undefined;
    if (!account) {
      throw new Error(
        `upsertInstallation: account '${input.accountLogin}' not found — call upsertAccount first`
      );
    }
    const now = Date.now();
    handle
      .prepare(
        `INSERT INTO installations (id, account_id, account_login, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           account_id = excluded.account_id,
           account_login = excluded.account_login`
      )
      .run(input.id, account.id, input.accountLogin, now);
    const row = handle
      .prepare(`SELECT * FROM installations WHERE id = ?`)
      .get(input.id) as InstallationRow;
    return rowToInstallation(row);
  }

  function listRepos(installationId: number): RepoRecord[] {
    const handle = require_db();
    const rows = handle
      .prepare(
        `SELECT * FROM repos WHERE installation_id = ? ORDER BY last_opened_at DESC NULLS LAST, owner, name`
      )
      .all(installationId) as RepoRow[];
    return rows.map(rowToRepo);
  }

  function upsertRepo(input: {
    installationId: number;
    owner: string;
    name: string;
    defaultBranch: string;
    fsPath: string;
  }): RepoRecord {
    const handle = require_db();
    handle
      .prepare(
        `INSERT INTO repos (installation_id, owner, name, default_branch, fs_path)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner, name) DO UPDATE SET
           installation_id = excluded.installation_id,
           default_branch  = excluded.default_branch,
           fs_path         = excluded.fs_path`
      )
      .run(
        input.installationId,
        input.owner,
        input.name,
        input.defaultBranch,
        input.fsPath
      );
    const row = handle
      .prepare(`SELECT * FROM repos WHERE owner = ? AND name = ?`)
      .get(input.owner, input.name) as RepoRow;
    return rowToRepo(row);
  }

  function touchRepoOpened(owner: string, name: string): void {
    const handle = require_db();
    handle
      .prepare(
        `UPDATE repos SET last_opened_at = ? WHERE owner = ? AND name = ?`
      )
      .run(Date.now(), owner, name);
  }

  function getPref<T>(key: string): T | null {
    const handle = require_db();
    const row = handle
      .prepare(`SELECT value FROM prefs WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  function setPref<T>(key: string, value: T): void {
    const handle = require_db();
    handle
      .prepare(
        `INSERT INTO prefs (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, JSON.stringify(value));
  }

  function listRecentProjects(): RecentProjectRow[] {
    const handle = require_db();
    const rows = handle
      .prepare(
        `SELECT path, name FROM recent_projects ORDER BY last_opened_at DESC`
      )
      .all() as { path: string; name: string }[];
    return rows;
  }

  function addRecentProject(projectPath: string, name: string): void {
    const handle = require_db();
    handle
      .prepare(
        `INSERT INTO recent_projects (path, name, last_opened_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name,
           last_opened_at = excluded.last_opened_at`
      )
      .run(projectPath, name, Date.now());
  }

  function syncAppContext(currentAppId: number): {
    changed: boolean;
    previousAppId: number | null;
  } {
    const handle = require_db();
    const previousAppId = getPref<number>("current_app_id");
    if (previousAppId === currentAppId) {
      return { changed: false, previousAppId };
    }
    // Either first boot (previousAppId === null) OR the App ID changed.
    // In either case, app-bound rows must not survive: a fresh App's
    // installation IDs are a different namespace from the old App's.
    const tx = handle.transaction(() => {
      handle.exec(`DELETE FROM repos`);
      handle.exec(`DELETE FROM installations`);
      handle
        .prepare(
          `INSERT INTO prefs (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run("current_app_id", JSON.stringify(currentAppId));
    });
    tx();
    return { changed: true, previousAppId };
  }

  return {
    open,
    close,
    upsertAccount,
    listInstallations,
    upsertInstallation,
    listRepos,
    upsertRepo,
    touchRepoOpened,
    getPref,
    setPref,
    listRecentProjects,
    addRecentProject,
    syncAppContext,
  };
}
