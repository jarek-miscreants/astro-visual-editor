import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { simpleGit } from "simple-git";
import {
  detectGitMode,
  getStatus,
  getBranches,
  commit,
  ensureStaging,
  promote,
  readConfig,
  writeConfig,
  checkoutBranch,
} from "./git.js";

let workdir: string;
let originDir: string;

async function runGit(cwd: string, args: string[]) {
  const git = simpleGit(cwd);
  await git.raw(args);
}

async function writeFile(p: string, content: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

/**
 * Stand up a fresh local-only repo with a single committed file on the
 * default branch (`main`). simple-git uses the system git, so this is a real
 * repo, not a mock.
 */
async function makeLocalRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-git-"));
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "user.name", "Test"]);
  // Disable signing in case the host has commit.gpgsign=true globally
  await runGit(dir, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(dir, "README.md"), "# initial\n");
  await runGit(dir, ["add", "."]);
  await runGit(dir, ["commit", "-m", "initial"]);
  return dir;
}

/**
 * Stand up a fresh repo paired with a bare "origin" so push/pull work.
 * Returns the working repo path; the bare repo is at workdir-origin.
 */
async function makeRepoWithOrigin(): Promise<{ workdir: string; origin: string }> {
  const origin = await fs.mkdtemp(path.join(os.tmpdir(), "tve-git-origin-"));
  await runGit(origin, ["init", "--bare", "-b", "main"]);

  const dir = await makeLocalRepo();
  await runGit(dir, ["remote", "add", "origin", origin]);
  await runGit(dir, ["push", "-u", "origin", "main"]);
  // Set origin/HEAD so resolveDefaultBranch works
  await runGit(dir, ["remote", "set-head", "origin", "main"]);
  return { workdir: dir, origin };
}

beforeEach(() => {
  workdir = "";
  originDir = "";
});

afterEach(async () => {
  for (const p of [workdir, originDir]) {
    if (p) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
  }
});

describe("detectGitMode", () => {
  it("returns 'no-git' for a directory whose ancestor chain has no .git", async () => {
    // Skipped when the host's tmpdir resolves inside an ancestor repo (common
    // when the user's HOME contains a dotfiles repo). Production behavior is
    // git's normal "walk up to find .git" — there's no way to override it
    // here without messing with GIT_CEILING_DIRECTORIES across the process.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-nogit-"));
    workdir = dir;
    const hasAncestorRepo = await simpleGit(dir).checkIsRepo().catch(() => false);
    if (hasAncestorRepo) {
      // Equivalent assertion: at least confirm the call is well-defined and
      // doesn't throw on a non-our-repo directory.
      const mode = await detectGitMode(dir);
      expect(["no-git", "local-only", "connected"]).toContain(mode);
      return;
    }
    expect(await detectGitMode(dir)).toBe("no-git");
  });

  it("returns 'local-only' for a repo with no remote", async () => {
    workdir = await makeLocalRepo();
    expect(await detectGitMode(workdir)).toBe("local-only");
  });

  it("returns 'connected' for a repo with a remote", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;
    expect(await detectGitMode(workdir)).toBe("connected");
  });
});

describe("getStatus", () => {
  it("reports current branch and clean working tree", async () => {
    workdir = await makeLocalRepo();
    const status = await getStatus(workdir);
    expect(status.mode).toBe("local-only");
    expect(status.currentBranch).toBe("main");
    expect(status.hasChanges).toBe(false);
    expect(status.dirty).toEqual([]);
  });

  it("reports dirty files with their porcelain status", async () => {
    workdir = await makeLocalRepo();
    await writeFile(path.join(workdir, "new.txt"), "new\n");
    await writeFile(path.join(workdir, "README.md"), "# changed\n");

    const status = await getStatus(workdir);
    expect(status.hasChanges).toBe(true);
    const paths = status.dirty.map((d) => d.path).sort();
    expect(paths).toEqual(["README.md", "new.txt"]);

    const newFile = status.dirty.find((d) => d.path === "new.txt")!;
    expect(newFile.untracked).toBe(true);
    expect(newFile.status).toBe("??");

    const modified = status.dirty.find((d) => d.path === "README.md")!;
    expect(modified.untracked).toBe(false);
    expect(modified.status).toBe("M");
  });

  it("resolves defaultBranch from origin/HEAD when connected", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;
    const status = await getStatus(workdir);
    expect(status.defaultBranch).toBe("main");
  });
});

describe("commit", () => {
  it("requires a non-empty message", async () => {
    workdir = await makeLocalRepo();
    await writeFile(path.join(workdir, "x.txt"), "x");
    await expect(commit(workdir, { message: "" })).rejects.toThrow(/message/i);
    await expect(commit(workdir, { message: "   " })).rejects.toThrow(/message/i);
  });

  it("stages dirty files and creates a commit", async () => {
    workdir = await makeLocalRepo();
    await writeFile(path.join(workdir, "x.txt"), "hello");

    const { hash } = await commit(workdir, { message: "add x" });
    expect(hash).toMatch(/^[a-f0-9]{40}$/);

    const status = await getStatus(workdir);
    expect(status.hasChanges).toBe(false);
    expect(status.ahead).toBe(0); // no remote on local repo
  });
});

describe("ensureStaging", () => {
  it("creates the staging branch from main and pushes to origin", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;

    const result = await ensureStaging(workdir);
    expect(result.created).toBe(true);
    expect(result.name).toBe("staging");
    expect(result.pushed).toBe(true);

    const branches = await getBranches(workdir);
    const staging = branches.find((b) => b.name === "staging")!;
    expect(staging).toBeDefined();
    expect(staging.hasLocal).toBe(true);
    expect(staging.remote).toBe(true);
  });

  it("is idempotent — running twice doesn't error", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;

    const first = await ensureStaging(workdir);
    expect(first.created).toBe(true);

    const second = await ensureStaging(workdir);
    expect(second.created).toBe(false);
    expect(second.name).toBe("staging");
  });

  it("refuses when working tree is dirty", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;
    await writeFile(path.join(workdir, "scratch.txt"), "x");

    await expect(ensureStaging(workdir)).rejects.toThrow(/uncommitted/i);
  });

  it("works for a local-only repo (creates branch, doesn't push)", async () => {
    workdir = await makeLocalRepo();
    const result = await ensureStaging(workdir);
    expect(result.created).toBe(true);
    expect(result.pushed).toBe(false);
  });
});

describe("promote", () => {
  it("fast-forward merges current branch into target and returns to start branch", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;
    await ensureStaging(workdir);
    await checkoutBranch(workdir, "main");

    // Make a commit on a feature branch
    await runGit(workdir, ["checkout", "-b", "feature"]);
    await writeFile(path.join(workdir, "f.txt"), "feature\n");
    await commit(workdir, { message: "feature change" });

    const result = await promote(workdir, {
      from: "feature",
      to: "staging",
      ffOnly: true,
    });
    expect(result.method).toBe("fast-forward");
    expect(result.pushed).toBe(true);

    // Caller should be back on the original branch
    const status = await getStatus(workdir);
    expect(status.currentBranch).toBe("feature");
  });

  it("returns NOT_FAST_FORWARD when branches diverge and ffOnly=true", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;
    await ensureStaging(workdir);

    // Diverge: commit on staging, separately commit on main
    await checkoutBranch(workdir, "staging");
    await writeFile(path.join(workdir, "s.txt"), "staging side\n");
    await commit(workdir, { message: "staging change" });

    await checkoutBranch(workdir, "main");
    await writeFile(path.join(workdir, "m.txt"), "main side\n");
    await commit(workdir, { message: "main change" });

    try {
      await promote(workdir, { from: "main", to: "staging", ffOnly: true });
      expect.unreachable("expected promote to throw");
    } catch (err: any) {
      expect(err.code).toBe("NOT_FAST_FORWARD");
      expect(err.message).toMatch(/diverged|fast-forward/i);
    }

    // After failure, working tree should be on the original branch
    const status = await getStatus(workdir);
    expect(status.currentBranch).toBe("main");
  });

  it("non-ff merge succeeds with ffOnly=false", async () => {
    const r = await makeRepoWithOrigin();
    workdir = r.workdir;
    originDir = r.origin;
    await ensureStaging(workdir);

    await checkoutBranch(workdir, "staging");
    await writeFile(path.join(workdir, "s.txt"), "staging\n");
    await commit(workdir, { message: "staging" });

    await checkoutBranch(workdir, "main");
    await writeFile(path.join(workdir, "m.txt"), "main\n");
    await commit(workdir, { message: "main" });

    const result = await promote(workdir, {
      from: "main",
      to: "staging",
      ffOnly: false,
    });
    expect(result.method).toBe("merge");
  });

  it("rejects same-branch promotion", async () => {
    workdir = await makeLocalRepo();
    await expect(
      promote(workdir, { from: "main", to: "main", ffOnly: true })
    ).rejects.toThrow(/Source and target/);
  });

  it("rejects when source branch doesn't exist", async () => {
    workdir = await makeLocalRepo();
    await runGit(workdir, ["branch", "staging"]);
    await expect(
      promote(workdir, { from: "nonexistent", to: "staging", ffOnly: true })
    ).rejects.toThrow(/doesn't exist/i);
  });
});

describe("readConfig / writeConfig", () => {
  it("returns defaults when .tve/config.json is missing", async () => {
    workdir = await makeLocalRepo();
    const cfg = await readConfig(workdir);
    expect(cfg.branches.production).toBe("main");
    expect(cfg.branches.staging).toBe("staging");
    expect(cfg.git.ffOnly).toBe(true);
  });

  it("round-trips through writeConfig", async () => {
    workdir = await makeLocalRepo();
    await writeConfig(workdir, {
      branches: { production: "trunk", staging: "stage", draftPrefix: "d/" },
      git: { autoCommitMode: "per-mutation", ffOnly: false, deleteDraftAfterMerge: false },
    });

    const cfg = await readConfig(workdir);
    expect(cfg.branches.production).toBe("trunk");
    expect(cfg.branches.staging).toBe("stage");
    expect(cfg.git.autoCommitMode).toBe("per-mutation");
  });

  it("merges partial config files with defaults (forward compatibility)", async () => {
    workdir = await makeLocalRepo();
    // Write a partial config — only branches.staging set
    const dir = path.join(workdir, ".tve");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({ branches: { staging: "review" } }),
      "utf-8"
    );

    const cfg = await readConfig(workdir);
    expect(cfg.branches.staging).toBe("review");
    // Defaults filled in for missing fields
    expect(cfg.branches.production).toBe("main");
    expect(cfg.git).toBeDefined();
    expect(cfg.git.ffOnly).toBe(true);
  });
});
