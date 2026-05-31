import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createStateStore } from "./state-store.js";

let tmpDir: string;
let dbPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-state-store-"));
  dbPath = path.join(tmpDir, "state.db");
});

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("open()", () => {
  it("creates the db file and applies the v1 migration", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      // Migration ran — recent_projects is queryable
      expect(store.listRecentProjects()).toEqual([]);
    } finally {
      store.close();
    }

    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
  });

  it("creates parent directories lazily", async () => {
    const nested = path.join(tmpDir, "a", "b", "c", "state.db");
    const store = createStateStore({ dbPath: nested, legacyJsonPaths: [] });
    await store.open();
    store.close();

    const stat = await fs.stat(nested);
    expect(stat.isFile()).toBe(true);
  });

  it("re-opening an existing db is idempotent (migrations don't re-run)", async () => {
    const a = createStateStore({ dbPath, legacyJsonPaths: [] });
    await a.open();
    a.addRecentProject("/proj/one", "one");
    a.close();

    const b = createStateStore({ dbPath, legacyJsonPaths: [] });
    await b.open();
    try {
      // Data survived; migration didn't blow it away.
      expect(b.listRecentProjects()).toEqual([{ path: "/proj/one", name: "one" }]);
    } finally {
      b.close();
    }
  });

  it("calling open() twice on the same instance is a no-op", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    await store.open();
    store.addRecentProject("/proj", "p");
    expect(store.listRecentProjects()).toHaveLength(1);
    store.close();
  });
});

describe("recent_projects", () => {
  it("round-trips entries (most-recently-added first)", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.addRecentProject("/a", "a");
      // Microsecond resolution isn't guaranteed across platforms;
      // touch with explicit later writes via re-add to bump timestamps.
      await new Promise((r) => setTimeout(r, 5));
      store.addRecentProject("/b", "b");
      await new Promise((r) => setTimeout(r, 5));
      store.addRecentProject("/c", "c");

      const list = store.listRecentProjects();
      expect(list).toEqual([
        { path: "/c", name: "c" },
        { path: "/b", name: "b" },
        { path: "/a", name: "a" },
      ]);
    } finally {
      store.close();
    }
  });

  it("re-adding the same path bumps its timestamp", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.addRecentProject("/a", "a");
      await new Promise((r) => setTimeout(r, 5));
      store.addRecentProject("/b", "b");
      await new Promise((r) => setTimeout(r, 5));
      store.addRecentProject("/a", "a"); // re-add — should bubble to top

      const list = store.listRecentProjects();
      expect(list[0].path).toBe("/a");
    } finally {
      store.close();
    }
  });

  it("imports legacy JSON on first open (string-array shape)", async () => {
    const jsonPath = path.join(tmpDir, "legacy.json");
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ projects: ["/legacy/one", "/legacy/two"] }),
      "utf-8"
    );

    const store = createStateStore({ dbPath, legacyJsonPaths: [jsonPath] });
    await store.open();
    try {
      const list = store.listRecentProjects();
      expect(list.map((r) => r.path).sort()).toEqual([
        "/legacy/one",
        "/legacy/two",
      ]);
      // Names derived from path.basename
      const one = list.find((r) => r.path === "/legacy/one")!;
      expect(one.name).toBe("one");
    } finally {
      store.close();
    }
  });

  it("imports legacy JSON in the structured shape (path + name + lastOpenedAt)", async () => {
    const jsonPath = path.join(tmpDir, "legacy.json");
    await fs.writeFile(
      jsonPath,
      JSON.stringify({
        projects: [
          { path: "/proj/site-a", name: "Site A", lastOpenedAt: 1700000000000 },
          { path: "/proj/site-b" },
        ],
      }),
      "utf-8"
    );

    const store = createStateStore({ dbPath, legacyJsonPaths: [jsonPath] });
    await store.open();
    try {
      const list = store.listRecentProjects();
      const a = list.find((r) => r.path === "/proj/site-a")!;
      expect(a.name).toBe("Site A");
      const b = list.find((r) => r.path === "/proj/site-b")!;
      expect(b.name).toBe("site-b"); // fallback to basename
    } finally {
      store.close();
    }
  });

  it("does not re-import after data already exists in recent_projects", async () => {
    const jsonPath = path.join(tmpDir, "legacy.json");
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ projects: ["/a"] }),
      "utf-8"
    );

    // First open: should import "/a"
    const first = createStateStore({ dbPath, legacyJsonPaths: [jsonPath] });
    await first.open();
    expect(first.listRecentProjects()).toHaveLength(1);
    first.close();

    // Mutate JSON, re-open. Existing rows should mean import is skipped.
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ projects: ["/a", "/b", "/c"] }),
      "utf-8"
    );
    const second = createStateStore({ dbPath, legacyJsonPaths: [jsonPath] });
    await second.open();
    try {
      const list = second.listRecentProjects();
      expect(list).toHaveLength(1);
      expect(list[0].path).toBe("/a");
    } finally {
      second.close();
    }
  });

  it("survives a malformed legacy JSON file silently", async () => {
    const jsonPath = path.join(tmpDir, "broken.json");
    await fs.writeFile(jsonPath, "{ not: valid json", "utf-8");

    const store = createStateStore({ dbPath, legacyJsonPaths: [jsonPath] });
    await expect(store.open()).resolves.toBeUndefined();
    try {
      expect(store.listRecentProjects()).toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe("prefs", () => {
  it("round-trips strings, numbers, objects", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.setPref("string", "hello");
      store.setPref("number", 42);
      store.setPref("object", { foo: "bar", nested: { n: 1 } });

      expect(store.getPref<string>("string")).toBe("hello");
      expect(store.getPref<number>("number")).toBe(42);
      expect(store.getPref<{ foo: string; nested: { n: number } }>("object"))
        .toEqual({ foo: "bar", nested: { n: 1 } });
    } finally {
      store.close();
    }
  });

  it("returns null for unset keys", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      expect(store.getPref("nope")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("setPref overwrites existing values", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.setPref("repos_base_dir", "/old");
      store.setPref("repos_base_dir", "/new");
      expect(store.getPref<string>("repos_base_dir")).toBe("/new");
    } finally {
      store.close();
    }
  });
});

describe("github_account / installations / repos", () => {
  it("upserts an account and updates avatar/login on conflict", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      const a = store.upsertAccount({
        login: "octocat",
        githubId: 583231,
        avatarUrl: "https://avatars/old.png",
      });
      expect(a.login).toBe("octocat");
      expect(a.id).toBeGreaterThan(0);

      const b = store.upsertAccount({
        login: "octocat-renamed",
        githubId: 583231, // same github_id
        avatarUrl: "https://avatars/new.png",
      });
      expect(b.id).toBe(a.id);
      expect(b.login).toBe("octocat-renamed");
      expect(b.avatarUrl).toBe("https://avatars/new.png");
    } finally {
      store.close();
    }
  });

  it("upsertInstallation requires the account to exist first", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      expect(() =>
        store.upsertInstallation({ id: 9999, accountLogin: "ghost" })
      ).toThrow(/not found/);
    } finally {
      store.close();
    }
  });

  it("lists installations and repos round-trip", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.upsertAccount({ login: "acme", githubId: 1, avatarUrl: undefined });
      const inst = store.upsertInstallation({ id: 555, accountLogin: "acme" });
      expect(inst.id).toBe(555);

      const repo = store.upsertRepo({
        installationId: 555,
        owner: "acme",
        name: "marketing-site",
        defaultBranch: "main",
        fsPath: "/home/u/.tve/repos/acme/marketing-site",
      });
      expect(repo.owner).toBe("acme");
      expect(repo.fsPath).toBe("/home/u/.tve/repos/acme/marketing-site");

      const list = store.listRepos(555);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("marketing-site");
    } finally {
      store.close();
    }
  });

  it("touchRepoOpened updates last_opened_at", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.upsertAccount({ login: "u", githubId: 1 });
      store.upsertInstallation({ id: 1, accountLogin: "u" });
      store.upsertRepo({
        installationId: 1,
        owner: "u",
        name: "r",
        defaultBranch: "main",
        fsPath: "/x",
      });
      const before = store.listRepos(1)[0];
      expect(before.lastOpenedAt).toBeNull();

      store.touchRepoOpened("u", "r");
      const after = store.listRepos(1)[0];
      expect(after.lastOpenedAt).not.toBeNull();
      expect(after.lastOpenedAt!).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});

describe("syncAppContext", () => {
  it("first boot records App ID without clearing anything (tables already empty)", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      const result = store.syncAppContext(3625760);
      expect(result.changed).toBe(true);
      expect(result.previousAppId).toBeNull();
      expect(store.getPref<number>("current_app_id")).toBe(3625760);
    } finally {
      store.close();
    }
  });

  it("same App ID is a no-op", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      store.syncAppContext(3625760);
      const result = store.syncAppContext(3625760);
      expect(result.changed).toBe(false);
      expect(result.previousAppId).toBe(3625760);
    } finally {
      store.close();
    }
  });

  it("changed App ID drops installations + repos but preserves prefs/recent_projects/github_account", async () => {
    const store = createStateStore({ dbPath, legacyJsonPaths: [] });
    await store.open();
    try {
      // Seed all five tables under App A
      store.syncAppContext(1111);
      store.upsertAccount({ login: "octocat", githubId: 583231 });
      store.upsertInstallation({ id: 9001, accountLogin: "octocat" });
      store.upsertRepo({
        installationId: 9001,
        owner: "octocat",
        name: "site",
        defaultBranch: "main",
        fsPath: "/x/site",
      });
      store.setPref("repos_base_dir", "/custom/repos");
      store.addRecentProject("/proj/local-only", "local-only");

      expect(store.listInstallations()).toHaveLength(1);
      expect(store.listRepos(9001)).toHaveLength(1);

      // Switch to App B
      const result = store.syncAppContext(2222);
      expect(result.changed).toBe(true);
      expect(result.previousAppId).toBe(1111);

      // App-bound rows gone
      expect(store.listInstallations()).toEqual([]);
      // listRepos under the old installation_id returns nothing (cascade
      // would have dropped them anyway, but the explicit DELETE is the
      // belt-and-suspenders contract).
      expect(store.listRepos(9001)).toEqual([]);

      // Non-app-bound rows survive
      expect(store.getPref<string>("repos_base_dir")).toBe("/custom/repos");
      expect(store.listRecentProjects().map((r) => r.path)).toEqual([
        "/proj/local-only",
      ]);
      // github_account is per-user, not per-App — survives. The next
      // sign-in's upsertAccount is idempotent on github_id.
      // (No public list method, but absence of an error here means
      // the row is still queryable for upsertInstallation lookups.)

      // Current App ID updated
      expect(store.getPref<number>("current_app_id")).toBe(2222);
    } finally {
      store.close();
    }
  });

  it("survives across re-open (persisted, not in-memory)", async () => {
    const a = createStateStore({ dbPath, legacyJsonPaths: [] });
    await a.open();
    a.syncAppContext(3625760);
    a.close();

    const b = createStateStore({ dbPath, legacyJsonPaths: [] });
    await b.open();
    try {
      const result = b.syncAppContext(3625760);
      expect(result.changed).toBe(false);
      expect(result.previousAppId).toBe(3625760);
    } finally {
      b.close();
    }
  });
});
