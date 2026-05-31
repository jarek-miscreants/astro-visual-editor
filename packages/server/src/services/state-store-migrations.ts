import type Database from "better-sqlite3";

/**
 * Schema migrations for `~/.tve/state.db`. Append new versions at the
 * end — never edit a shipped migration. `migrate()` runs each missing
 * one in a transaction and records success in `schema_version`.
 */

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const v1: Migration = {
  version: 1,
  description: "initial schema (Phase 1)",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS github_account (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL,
        github_id INTEGER NOT NULL UNIQUE,
        avatar_url TEXT,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS installations (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES github_account(id) ON DELETE CASCADE,
        account_login TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        fs_path TEXT NOT NULL,
        last_opened_at INTEGER,
        UNIQUE (owner, name)
      );

      CREATE TABLE IF NOT EXISTS prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recent_projects (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
    `);
  },
};

export const migrations: Migration[] = [v1];

export function migrate(db: Database.Database): void {
  // Bootstrap: schema_version is the one table we always create up-front
  // so we have somewhere to read the current version from.
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`
  );
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM schema_version`)
    .get() as { v: number | null };
  const currentVersion = row.v ?? 0;

  for (const m of migrations) {
    if (m.version <= currentVersion) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(
        m.version
      );
    });
    tx();
  }
}
