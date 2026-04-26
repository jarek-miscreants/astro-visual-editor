import path from "path";
import fs from "fs/promises";
import { simpleGit, type SimpleGit } from "simple-git";
import type {
  GitStatus,
  GitMode,
  GitBranchInfo,
  GitDiffEntry,
  GitCommitInfo,
  TveBranchConfig,
  GitDirtyFile,
} from "@tve/shared";

const DEFAULT_CONFIG: TveBranchConfig = {
  branches: {
    production: "main",
    staging: "staging",
    draftPrefix: "tve/draft-",
  },
  git: {
    autoCommitMode: "staged",
    ffOnly: true,
    deleteDraftAfterMerge: true,
  },
};

/**
 * Detect whether the project directory is a git repo, and whether it has a
 * remote configured. Used to gate UI surfaces that don't make sense for a
 * non-repo project (e.g. the "Push" button when there's no remote).
 */
export async function detectGitMode(projectPath: string): Promise<GitMode> {
  try {
    const git = simpleGit(projectPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return "no-git";
    const remotes = await git.getRemotes(true);
    if (remotes.length === 0) return "local-only";
    // A remote URL of "" counts as not configured
    const hasUrl = remotes.some((r) => r.refs.fetch || r.refs.push);
    return hasUrl ? "connected" : "local-only";
  } catch {
    return "no-git";
  }
}

function makeGit(projectPath: string): SimpleGit {
  return simpleGit(projectPath);
}

function mapStatusFile(file: { path: string; index: string; working_dir: string }): GitDirtyFile {
  // simple-git's status returns index + working_dir letters per porcelain.
  // Untracked is "?" in both. Combine to a single letter for the UI.
  const idx = file.index;
  const wd = file.working_dir;
  const untracked = idx === "?" && wd === "?";
  let status: string;
  if (untracked) status = "??";
  else if (idx !== " " && idx !== "?") status = idx;
  else status = wd;
  return { path: file.path, status, untracked };
}

export async function getStatus(projectPath: string): Promise<GitStatus> {
  const mode = await detectGitMode(projectPath);
  if (mode === "no-git") {
    return {
      mode,
      currentBranch: null,
      defaultBranch: null,
      ahead: 0,
      behind: 0,
      dirty: [],
      hasChanges: false,
      lastFetchAt: null,
    };
  }

  const git = makeGit(projectPath);
  const status = await git.status();

  let defaultBranch: string | null = null;
  if (mode === "connected") {
    defaultBranch = await resolveDefaultBranch(git).catch(() => null);
  }

  // FETCH_HEAD's mtime is a decent proxy for "last fetched"
  let lastFetchAt: string | null = null;
  try {
    const stat = await fs.stat(path.join(projectPath, ".git", "FETCH_HEAD"));
    lastFetchAt = stat.mtime.toISOString();
  } catch {
    // no fetch yet
  }

  const dirty = status.files.map(mapStatusFile);

  return {
    mode,
    currentBranch: status.current,
    defaultBranch,
    ahead: status.ahead,
    behind: status.behind,
    dirty,
    hasChanges: dirty.length > 0,
    lastFetchAt,
  };
}

/**
 * Resolve the default branch on origin (the equivalent of GitHub's "default
 * branch"). Falls back gracefully when origin/HEAD isn't set.
 */
async function resolveDefaultBranch(git: SimpleGit): Promise<string> {
  try {
    const out = await git.raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    // e.g. "origin/main"
    const trimmed = out.trim();
    if (trimmed.startsWith("origin/")) return trimmed.slice("origin/".length);
    return trimmed;
  } catch {
    // Fallback: pick `main` if it exists, else `master`, else throw
    const branches = await git.branch(["-r"]);
    const candidates = ["origin/main", "origin/master"];
    for (const c of candidates) {
      if (branches.all.includes(c)) return c.slice("origin/".length);
    }
    throw new Error("Could not resolve default branch on origin");
  }
}

export async function getBranches(projectPath: string): Promise<GitBranchInfo[]> {
  const git = makeGit(projectPath);
  const local = await git.branchLocal();
  const remote = await git.branch(["-r"]).catch(() => ({ all: [] as string[], branches: {} as Record<string, any> }));

  const localNames = new Set(local.all);
  const result: GitBranchInfo[] = [];

  for (const name of local.all) {
    const info = local.branches[name];
    result.push({
      name,
      current: name === local.current,
      remote: false,
      hasLocal: true,
      lastCommitSubject: info?.label,
    });
  }
  for (const remoteName of remote.all) {
    if (remoteName.endsWith("/HEAD")) continue;
    // remoteName is like "origin/main" — strip prefix for display
    const stripped = remoteName.startsWith("origin/")
      ? remoteName.slice("origin/".length)
      : remoteName;
    if (localNames.has(stripped)) {
      // Already added as a local; mark it as also-on-remote
      const existing = result.find((b) => b.name === stripped);
      if (existing) existing.remote = true;
      continue;
    }
    result.push({
      name: stripped,
      current: false,
      remote: true,
      hasLocal: false,
    });
  }
  return result;
}

/**
 * Diff for the entire working tree, one entry per changed file. Untracked
 * files show up with their full content as the patch (rendered via `git diff
 * --no-index`-style fallback).
 */
export async function getDiff(projectPath: string): Promise<GitDiffEntry[]> {
  const git = makeGit(projectPath);
  const status = await git.status();
  const out: GitDiffEntry[] = [];

  // Tracked changes (modified, staged, deleted, renamed)
  for (const file of status.files) {
    if (file.index === "?" && file.working_dir === "?") continue;
    const patch = await git
      .diff(["HEAD", "--", file.path])
      .catch(() => "");
    out.push({
      path: file.path,
      status: file.index !== " " && file.index !== "?" ? file.index : file.working_dir,
      patch,
    });
  }

  // Untracked files: synthesize a "+" patch by reading the file
  for (const untrackedPath of status.not_added) {
    let patch = "";
    try {
      const abs = path.join(projectPath, untrackedPath);
      const content = await fs.readFile(abs, "utf-8");
      patch = content
        .split(/\r?\n/)
        .map((line) => `+${line}`)
        .join("\n");
    } catch {
      patch = "(binary or unreadable)";
    }
    out.push({ path: untrackedPath, status: "??", patch });
  }

  return out;
}

export interface CommitOptions {
  message: string;
  /** When omitted, all dirty files are staged */
  files?: string[];
}

export async function commit(
  projectPath: string,
  opts: CommitOptions
): Promise<{ hash: string }> {
  if (!opts.message?.trim()) {
    throw new Error("Commit message is required");
  }
  const git = makeGit(projectPath);
  if (opts.files && opts.files.length > 0) {
    await git.add(opts.files);
  } else {
    // Stage everything (modified + untracked + deletions)
    await git.add(["-A"]);
  }
  const result = await git.commit(opts.message);
  return { hash: result.commit };
}

export interface PushOptions {
  branch?: string;
  setUpstream?: boolean;
}

export async function push(projectPath: string, opts: PushOptions = {}): Promise<void> {
  const git = makeGit(projectPath);
  const args: string[] = [];
  if (opts.setUpstream) args.push("--set-upstream");
  if (opts.branch) args.push("origin", opts.branch);
  await git.push(args.length > 0 ? args : undefined);
}

export interface PullOptions {
  mode: "ff-only" | "merge" | "rebase";
  branch?: string;
}

export async function pull(projectPath: string, opts: PullOptions): Promise<void> {
  const git = makeGit(projectPath);
  const args: string[] = [];
  if (opts.mode === "ff-only") args.push("--ff-only");
  else if (opts.mode === "rebase") args.push("--rebase");
  if (opts.branch) args.push("origin", opts.branch);
  await git.pull(args.length > 0 ? args : undefined);
}

/**
 * Recent commit log on the current branch. Capped to keep the panel snappy.
 */
export async function getRecentCommits(
  projectPath: string,
  limit = 20
): Promise<GitCommitInfo[]> {
  const git = makeGit(projectPath);
  const log = await git.log({ maxCount: limit });
  return log.all.map((c) => ({
    hash: c.hash,
    shortHash: c.hash.slice(0, 7),
    subject: c.message,
    author: c.author_name,
    date: c.date,
  }));
}

/**
 * Switch to an existing branch. Refuses when the working tree has uncommitted
 * changes — silent stash would surprise the user. The caller (route or UI)
 * surfaces a clear error so they can commit or discard first.
 */
export async function checkoutBranch(
  projectPath: string,
  branch: string
): Promise<void> {
  const git = makeGit(projectPath);
  const status = await git.status();
  if (status.files.length > 0) {
    throw new Error(
      "You have uncommitted changes. Commit or discard them before switching branches."
    );
  }
  // simple-git's checkout walks the same paths as `git checkout <branch>` — it
  // resolves remote-tracking branches automatically when no local branch
  // exists, creating a tracking branch.
  await git.checkout(branch);
}

export interface CreateBranchOptions {
  name: string;
  /** Branch to create from. Defaults to current HEAD. */
  fromBranch?: string;
  /** Switch to the new branch after creating it. Defaults to true. */
  checkout?: boolean;
}

export async function createBranch(
  projectPath: string,
  opts: CreateBranchOptions
): Promise<void> {
  const git = makeGit(projectPath);
  const checkout = opts.checkout ?? true;
  const args: string[] = ["branch", opts.name];
  if (opts.fromBranch) args.push(opts.fromBranch);
  await git.raw(args);
  if (checkout) {
    await git.checkout(opts.name);
  }
}

async function localBranchExists(git: SimpleGit, name: string): Promise<boolean> {
  const local = await git.branchLocal();
  return local.all.includes(name);
}

async function remoteBranchExists(git: SimpleGit, name: string): Promise<boolean> {
  try {
    const remote = await git.branch(["-r"]);
    return remote.all.includes(`origin/${name}`);
  } catch {
    return false;
  }
}

/**
 * Provision a staging branch if one doesn't already exist locally or on
 * origin. Branches from the configured production branch (resolved from
 * origin/HEAD when missing). Pushes with --set-upstream so Cloudflare Pages
 * picks it up. Refuses to run when the working tree is dirty.
 */
export async function ensureStaging(
  projectPath: string
): Promise<{ created: boolean; name: string; pushed: boolean }> {
  const git = makeGit(projectPath);
  const config = await readConfig(projectPath);
  const stagingName = config.branches.staging;

  // Resolve production from config; if the configured value isn't on origin,
  // fall back to origin/HEAD so we don't branch from a stale ref.
  let productionBranch = config.branches.production;
  try {
    const resolvedDefault = await resolveDefaultBranch(git);
    if (resolvedDefault && !(await localBranchExists(git, productionBranch))) {
      productionBranch = resolvedDefault;
    }
  } catch {
    // Local-only repo: stick with config value
  }

  const status = await git.status();
  if (status.files.length > 0) {
    throw new Error(
      "You have uncommitted changes. Commit or discard them before creating the staging branch."
    );
  }

  const localExists = await localBranchExists(git, stagingName);
  const remoteExists = await remoteBranchExists(git, stagingName);

  if (localExists && remoteExists) {
    return { created: false, name: stagingName, pushed: true };
  }

  if (!localExists && remoteExists) {
    // Remote has staging — just create a local tracking branch
    await git.checkout(["-b", stagingName, `origin/${stagingName}`]);
    return { created: true, name: stagingName, pushed: true };
  }

  // Need to create from production. Make sure production is up-to-date
  // (best-effort — local-only repos skip this).
  try {
    await git.checkout(productionBranch);
    if (await remoteBranchExists(git, productionBranch)) {
      await git.pull(["--ff-only", "origin", productionBranch]);
    }
  } catch (err: any) {
    throw new Error(
      `Couldn't update ${productionBranch} before branching: ${err?.message || err}`
    );
  }

  await git.checkoutLocalBranch(stagingName);

  let pushed = false;
  const remotes = await git.getRemotes(true);
  if (remotes.length > 0) {
    try {
      await git.push(["--set-upstream", "origin", stagingName]);
      pushed = true;
    } catch (err: any) {
      throw new Error(
        `Created ${stagingName} locally but push to origin failed: ${err?.message || err}`
      );
    }
  }

  return { created: true, name: stagingName, pushed };
}

export interface PromoteOptions {
  from: string;
  to: string;
  /** When true, refuse to merge non-fast-forward. Default true. */
  ffOnly?: boolean;
  /** Push the target branch to origin after merge. Default true when remote configured. */
  push?: boolean;
}

export interface PromoteResult {
  method: "fast-forward" | "merge";
  pushed: boolean;
  /** Branch we ended up on after the operation (the target branch on success) */
  currentBranch: string;
}

/**
 * Promote `from` into `to` by merging. FF-only by default — falls back to a
 * merge commit only when explicitly allowed. On conflict, aborts the merge
 * and throws a structured error so the UI can prompt for manual resolution.
 *
 * Steps:
 *   1. switch to `to`, pull --ff-only if it tracks a remote
 *   2. merge `from` (FF-only or not, per options)
 *   3. push `to` to origin
 *   4. switch back to the original branch
 */
export async function promote(
  projectPath: string,
  opts: PromoteOptions
): Promise<PromoteResult> {
  const git = makeGit(projectPath);
  const ffOnly = opts.ffOnly !== false;

  const status = await git.status();
  if (status.files.length > 0) {
    throw new Error(
      "You have uncommitted changes. Commit or discard them before promoting."
    );
  }
  if (!status.current) {
    throw new Error("Detached HEAD — check out a branch first.");
  }

  if (opts.from === opts.to) {
    throw new Error(`Source and target are both '${opts.from}'.`);
  }

  if (!(await localBranchExists(git, opts.from)) && !(await remoteBranchExists(git, opts.from))) {
    throw new Error(`Branch '${opts.from}' doesn't exist.`);
  }
  // 'to' must exist locally to merge into it. Create a tracking branch if it
  // only exists on origin.
  if (!(await localBranchExists(git, opts.to))) {
    if (await remoteBranchExists(git, opts.to)) {
      await git.raw(["branch", opts.to, `origin/${opts.to}`]);
    } else {
      throw new Error(`Branch '${opts.to}' doesn't exist.`);
    }
  }

  const remotes = await git.getRemotes(true);
  const hasRemote = remotes.length > 0;
  const shouldPush = opts.push !== false && hasRemote;
  const startBranch = status.current;

  try {
    await git.checkout(opts.to);

    // Best-effort sync so the merge is against latest origin/<to>
    if (hasRemote && (await remoteBranchExists(git, opts.to))) {
      try {
        await git.pull(["--ff-only", "origin", opts.to]);
      } catch {
        // Diverged from remote — let the merge surface that as a conflict
      }
    }

    const mergeArgs = ["merge"];
    if (ffOnly) mergeArgs.push("--ff-only");
    else mergeArgs.push("--no-ff", "-m", `Merge ${opts.from} into ${opts.to}`);
    mergeArgs.push(opts.from);

    let method: "fast-forward" | "merge" = "fast-forward";
    try {
      const out = await git.raw(mergeArgs);
      // `git merge --ff-only` says "Already up to date." or "Updating ...". A
      // non-ff merge says "Merge made by the 'ort' strategy". We just label
      // anything non-ff as 'merge'.
      if (!ffOnly) method = "merge";
      else if (/Merge made/i.test(out)) method = "merge";
    } catch (err: any) {
      // Abort any partial merge so the user is left on `to` with a clean tree
      try {
        await git.raw(["merge", "--abort"]);
      } catch {
        // No merge in progress, fine
      }
      // Restore original branch when possible
      try {
        await git.checkout(startBranch);
      } catch {
        // ignore
      }
      const message = err?.message || String(err);
      // Detect FF-impossible vs real conflict
      if (/not possible to fast-forward/i.test(message)) {
        const e: any = new Error(
          `Branch ${opts.to} has diverged from ${opts.from}. A fast-forward merge isn't possible.`
        );
        e.code = "NOT_FAST_FORWARD";
        throw e;
      }
      if (/conflict/i.test(message)) {
        const e: any = new Error(
          `Merge conflict between ${opts.from} and ${opts.to}. Resolve in your editor and commit before retrying.`
        );
        e.code = "MERGE_CONFLICT";
        throw e;
      }
      throw err;
    }

    let pushed = false;
    if (shouldPush) {
      try {
        await git.push(["origin", opts.to]);
        pushed = true;
      } catch (err: any) {
        throw new Error(
          `Merged into ${opts.to} locally but push failed: ${err?.message || err}`
        );
      }
    }

    return { method, pushed, currentBranch: opts.to };
  } finally {
    // Try to leave the user where they started, but don't fail the whole op
    // if checkout-back doesn't work.
    if (startBranch && startBranch !== opts.to) {
      try {
        await git.checkout(startBranch);
      } catch {
        // they're left on `to`, which is fine
      }
    }
  }
}

const CONFIG_REL_PATH = ".tve/config.json";

export async function readConfig(projectPath: string): Promise<TveBranchConfig> {
  const abs = path.join(projectPath, CONFIG_REL_PATH);
  try {
    const raw = await fs.readFile(abs, "utf-8");
    const parsed = JSON.parse(raw);
    // Shallow-merge with defaults so older config files keep working when
    // we add fields later.
    return {
      branches: { ...DEFAULT_CONFIG.branches, ...(parsed.branches || {}) },
      git: { ...DEFAULT_CONFIG.git, ...(parsed.git || {}) },
    };
  } catch (err: any) {
    if (err.code === "ENOENT") return { ...DEFAULT_CONFIG };
    throw err;
  }
}

export async function writeConfig(
  projectPath: string,
  config: TveBranchConfig
): Promise<void> {
  const abs = path.join(projectPath, CONFIG_REL_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
