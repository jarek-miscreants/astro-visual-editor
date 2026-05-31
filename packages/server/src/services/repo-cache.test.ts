import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createStateStore, type StateStore } from "./state-store.js";
import { createRepoCache } from "./repo-cache.js";

let tmpHome: string;
let store: StateStore;
let originalTveHome: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "tve-repo-cache-"));
  // Point both tve-paths and any incidental ~/.tve consumers at the tmp dir
  originalTveHome = process.env.TVE_HOME;
  process.env.TVE_HOME = tmpHome;

  store = createStateStore({
    dbPath: path.join(tmpHome, "state.db"),
    legacyJsonPaths: [],
  });
  await store.open();
});

afterEach(async () => {
  store.close();
  if (originalTveHome === undefined) delete process.env.TVE_HOME;
  else process.env.TVE_HOME = originalTveHome;
  if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
});

describe("resolveBaseDir", () => {
  it("default = tveReposBaseDir() (i.e. {TVE_HOME}/repos)", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    expect(base).toBe(path.join(tmpHome, "repos"));
  });

  it("prefs.repos_base_dir takes precedence over default", async () => {
    store.setPref("repos_base_dir", path.join(tmpHome, "elsewhere"));
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    expect(base).toBe(path.join(tmpHome, "elsewhere"));
  });

  it("explicit override beats prefs and default", async () => {
    store.setPref("repos_base_dir", path.join(tmpHome, "elsewhere"));
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir(path.join(tmpHome, "override"));
    expect(base).toBe(path.join(tmpHome, "override"));
  });

  it("ignores empty/whitespace prefs and overrides", async () => {
    store.setPref("repos_base_dir", "  ");
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir("  ");
    expect(base).toBe(path.join(tmpHome, "repos"));
  });
});

describe("resolvePath", () => {
  it("produces {base}/{owner}/{repo}/", () => {
    const cache = createRepoCache(store);
    const base = path.resolve("/base"); // path.resolve handles Windows drive letters
    const p = cache.resolvePath(base, "acme", "marketing-site");
    expect(p).toBe(path.join(base, "acme", "marketing-site"));
  });

  it("rejects owner with path separators or traversal", () => {
    const cache = createRepoCache(store);
    expect(() => cache.resolvePath("/base", "..", "repo")).toThrow(/Invalid owner/);
    expect(() => cache.resolvePath("/base", ".", "repo")).toThrow(/Invalid owner/);
    expect(() => cache.resolvePath("/base", "a/b", "repo")).toThrow(/Invalid owner/);
    expect(() => cache.resolvePath("/base", "a\\b", "repo")).toThrow(/Invalid owner/);
  });

  it("rejects repo with path separators or traversal", () => {
    const cache = createRepoCache(store);
    expect(() => cache.resolvePath("/base", "owner", "a/b")).toThrow(/Invalid repo/);
    expect(() => cache.resolvePath("/base", "owner", "a\\b")).toThrow(/Invalid repo/);
    expect(() => cache.resolvePath("/base", "owner", "..")).toThrow(/Invalid repo/);
    expect(() => cache.resolvePath("/base", "owner", ".")).toThrow(/Invalid repo/);
  });

  it("rejects Windows reserved device names", () => {
    const cache = createRepoCache(store);
    expect(() => cache.resolvePath("/base", "con", "repo")).toThrow(/reserved/);
    expect(() => cache.resolvePath("/base", "owner", "NUL")).toThrow(/reserved/);
    expect(() => cache.resolvePath("/base", "owner", "com1")).toThrow(/reserved/);
  });

  it("rejects empty owner or repo", () => {
    const cache = createRepoCache(store);
    expect(() => cache.resolvePath("/base", "", "r")).toThrow(/non-empty/);
    expect(() => cache.resolvePath("/base", "o", "")).toThrow(/non-empty/);
  });
});

describe("ensureDir / read / exists", () => {
  it("creates the nested directory tree and seeds .tve-meta.json", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");

    expect(await cache.exists(repoPath)).toBe(false);
    await cache.ensureDir(repoPath);
    expect(await cache.exists(repoPath)).toBe(true);

    const entry = await cache.read(repoPath);
    expect(entry).not.toBeNull();
    expect(entry!.owner).toBe("acme");
    expect(entry!.repo).toBe("site");
    expect(entry!.lockHash).toBeNull();
    expect(entry!.installedAt).toBeNull();
  });

  it("read() returns null for a non-existent path", async () => {
    const cache = createRepoCache(store);
    expect(await cache.read(path.join(tmpHome, "missing"))).toBeNull();
  });

  it("ensureDir is idempotent — does not overwrite existing meta", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");

    await cache.ensureDir(repoPath);
    await cache.recordLockHash(repoPath); // no lockfile → null hash, but installedAt set

    const before = await cache.read(repoPath);
    expect(before!.installedAt).not.toBeNull();

    await cache.ensureDir(repoPath); // second call

    const after = await cache.read(repoPath);
    // Existing meta survives — installedAt not reset to null
    expect(after!.installedAt).toBe(before!.installedAt);
  });
});

describe("recordLockHash / needsInstall", () => {
  it("hashes pnpm-lock.yaml when present", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);

    await fs.writeFile(
      path.join(repoPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf-8"
    );

    const hash = await cache.recordLockHash(repoPath);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    const meta = await cache.read(repoPath);
    expect(meta!.lockHash).toBe(hash);
    expect(meta!.installedAt).not.toBeNull();
  });

  it("falls back to package-lock.json then yarn.lock per priority", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);

    await fs.writeFile(path.join(repoPath, "package-lock.json"), "{}", "utf-8");
    const npmHash = await cache.recordLockHash(repoPath);
    expect(npmHash).toMatch(/^[a-f0-9]{64}$/);

    // Add pnpm-lock.yaml — it should win on priority
    await fs.writeFile(
      path.join(repoPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf-8"
    );
    const pnpmHash = await cache.recordLockHash(repoPath);
    expect(pnpmHash).not.toBe(npmHash);
  });

  it("needsInstall=false after recordLockHash for the same lockfile", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);
    await fs.writeFile(
      path.join(repoPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf-8"
    );

    await cache.recordLockHash(repoPath);
    expect(await cache.needsInstall(repoPath)).toBe(false);
  });

  it("needsInstall=true after the lockfile changes", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);
    await fs.writeFile(
      path.join(repoPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\nfoo: bar\n",
      "utf-8"
    );
    await cache.recordLockHash(repoPath);

    await fs.writeFile(
      path.join(repoPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\nfoo: baz\n",
      "utf-8"
    );
    expect(await cache.needsInstall(repoPath)).toBe(true);
  });

  it("needsInstall=true when no lockfile exists", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);

    expect(await cache.needsInstall(repoPath)).toBe(true);
  });

  it("needsInstall=true for a missing cache directory", async () => {
    const cache = createRepoCache(store);
    expect(await cache.needsInstall(path.join(tmpHome, "missing"))).toBe(true);
  });
});

describe("recordInstallation", () => {
  it("persists installation_id in .tve-meta.json", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);

    await cache.recordInstallation(repoPath, 130113952);

    const entry = await cache.read(repoPath);
    expect(entry).not.toBeNull();
    expect(entry!.installationId).toBe(130113952);
  });

  it("preserves lockHash and other meta when recording installation", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);

    await fs.writeFile(
      path.join(repoPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
      "utf-8"
    );
    const hash = await cache.recordLockHash(repoPath);
    await cache.recordInstallation(repoPath, 42);

    const entry = await cache.read(repoPath);
    expect(entry!.lockHash).toBe(hash);
    expect(entry!.installationId).toBe(42);
    expect(entry!.installedAt).not.toBeNull();
  });

  it("throws when the cache directory doesn't exist", async () => {
    const cache = createRepoCache(store);
    await expect(
      cache.recordInstallation(path.join(tmpHome, "missing"), 1)
    ).rejects.toThrow(/does not exist/);
  });

  it("read() returns installationId=null for a freshly-seeded directory", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);

    const entry = await cache.read(repoPath);
    expect(entry!.installationId).toBeNull();
  });
});

describe("remove", () => {
  it("deletes the cache directory", async () => {
    const cache = createRepoCache(store);
    const base = await cache.resolveBaseDir();
    const repoPath = cache.resolvePath(base, "acme", "site");
    await cache.ensureDir(repoPath);
    expect(await cache.exists(repoPath)).toBe(true);

    await cache.remove(repoPath);
    expect(await cache.exists(repoPath)).toBe(false);
  });

  it("is a no-op for a non-existent path", async () => {
    const cache = createRepoCache(store);
    await expect(
      cache.remove(path.join(tmpHome, "never-existed"))
    ).resolves.toBeUndefined();
  });
});
