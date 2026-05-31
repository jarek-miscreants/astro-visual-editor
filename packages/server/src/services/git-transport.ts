import { simpleGit } from "simple-git";

/**
 * Single seam for every network git operation. Phase 1 ships an ambient
 * pass-through (uses whatever auth git already has — SSH keys, OS
 * credential helper, etc.). Phase 2 swaps in a token-injecting
 * implementation that adds an `Authorization: Basic ...` extraheader
 * with a freshly-minted GitHub App installation token, scoped to the
 * single invocation.
 *
 * Local-only operations (status, log, diff, add, commit, branch,
 * checkout, stash, raw) stay on `simpleGit` directly — they don't touch
 * the network and don't need this indirection.
 */
export interface GitTransport {
  push(repoPath: string, args?: string[]): Promise<void>;
  pull(repoPath: string, args?: string[]): Promise<void>;
  fetch(repoPath: string, args?: string[]): Promise<void>;
  clone(url: string, dest: string, args?: string[]): Promise<void>;
}

/**
 * Phase 1: thin pass-through to `simpleGit`. No token injection.
 * Behavior is byte-for-byte identical to the pre-refactor calls.
 */
export function createAmbientGitTransport(): GitTransport {
  return {
    async push(repoPath, args) {
      await simpleGit(repoPath).push(args && args.length > 0 ? args : undefined);
    },
    async pull(repoPath, args) {
      await simpleGit(repoPath).pull(args && args.length > 0 ? args : undefined);
    },
    async fetch(repoPath, args) {
      await simpleGit(repoPath).fetch(args && args.length > 0 ? args : undefined);
    },
    async clone(url, dest, args) {
      await simpleGit().clone(url, dest, args);
    },
  };
}

/**
 * Resolves a fresh installation access token for a given local repo
 * path. Returns null when the repo isn't a TVE-managed clone (e.g.
 * a local-only project, or one cloned via the legacy CLI flow with
 * no `.tve-meta.json` recording an installation_id) — in which case
 * the token transport falls back to ambient git auth for that call.
 */
export interface InstallationTokenSource {
  tokenFor(repoPath: string): Promise<string | null>;
}

/**
 * Phase 2: per-call installation-token injection via
 * `git -c http.extraheader=Authorization: Basic ...`. The token never
 * lands on disk — `git -c` keeps the config flag scoped to a single
 * invocation, distinct from anything in `.git/config`.
 *
 * Falls back to ambient when `tokenFor` returns null. That keeps
 * pre-existing local repos (cloned manually, no App involvement)
 * pushing through the user's OS git auth as they always have.
 */
export function createTokenGitTransport(
  source: InstallationTokenSource
): GitTransport {
  const ambient = createAmbientGitTransport();

  async function authedRaw(
    repoPath: string,
    subcommand: "push" | "pull" | "fetch",
    args: string[] | undefined
  ): Promise<void> {
    const token = await source.tokenFor(repoPath);
    if (!token) {
      // Fall back to ambient — local-only repo or pre-clone path.
      console.log(
        `[git-transport] ${subcommand} via ambient auth (no installation token for ${repoPath})`
      );
      if (subcommand === "push") return ambient.push(repoPath, args);
      if (subcommand === "pull") return ambient.pull(repoPath, args);
      return ambient.fetch(repoPath, args);
    }
    console.log(
      `[git-transport] ${subcommand} via App installation token (${repoPath})`
    );
    const credential = Buffer.from(`x-access-token:${token}`).toString("base64");
    // `-c` config takes effect for this one git invocation only — it's
    // never written to `.git/config`. Process listing exposure is
    // limited to this call's lifetime and doesn't include the literal
    // token (only the base64-wrapped Authorization header value).
    const allArgs = [
      "-c",
      `http.extraheader=Authorization: Basic ${credential}`,
      subcommand,
      ...(args ?? []),
    ];
    await simpleGit(repoPath).raw(allArgs);
  }

  return {
    push(repoPath, args) {
      return authedRaw(repoPath, "push", args);
    },
    pull(repoPath, args) {
      return authedRaw(repoPath, "pull", args);
    },
    fetch(repoPath, args) {
      return authedRaw(repoPath, "fetch", args);
    },
    // Clone always happens via the embedded-URL path in
    // `services/github-clone.ts` (the destination doesn't exist yet
    // when clone is called, so there's no `.tve-meta.json` to read).
    // Ambient is correct here.
    clone: ambient.clone,
  };
}

let currentTransport: GitTransport = createAmbientGitTransport();

/** Replace the active transport. Phase 2 calls this from server boot
 *  when `mode === "desktop"` to switch to the token-injecting impl. */
export function setGitTransport(transport: GitTransport): void {
  currentTransport = transport;
}

/** Resolve the active transport. Defaults to the ambient pass-through
 *  so importers don't have to thread the transport through every call. */
export function getGitTransport(): GitTransport {
  return currentTransport;
}
