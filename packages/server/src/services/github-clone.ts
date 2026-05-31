import fs from "fs/promises";
import path from "path";
import { simpleGit } from "simple-git";
import { getGitTransport } from "./git-transport.js";
import { createRepoCache } from "./repo-cache.js";
import { installDependencies } from "./dependency-installer.js";
import type { GithubAppConfig } from "../lib/github-app-config.js";
import type { StateStore } from "./state-store.js";

/**
 * Clone (or refresh) a GitHub repo into the TVE repo cache, using a
 * freshly-minted installation token from the broker. The token is
 * scrubbed from `.git/config` immediately after clone so it never
 * persists on disk.
 *
 * On success, returns the absolute path of the cached checkout. The
 * caller (`/api/project/switch` kind=github) then runs the regular
 * project validator + `switchProject` flow against that path.
 *
 * Phase 2 — no streaming progress yet. Clone is blocking; large repos
 * take seconds to a minute. A follow-up task wires WebSocket progress
 * events.
 */

export type CloneFailureReason =
  | "no-broker"
  | "broker-unreachable"
  | "broker-token-failed"
  | "clone-failed"
  | "checkout-failed"
  | "install-failed";

export type CloneResult =
  | { ok: true; path: string; freshlyCloned: boolean }
  | { ok: false; reason: CloneFailureReason; detail: string };

export interface CloneInput {
  owner: string;
  repo: string;
  ref?: string;
  installationId: number;
  config: GithubAppConfig;
  stateStore: StateStore;
  /** Origin to send to the broker. Used by the broker's CORS allow-list. */
  callerOrigin: string;
  /** Override broker URL for tests. */
  fetchImpl?: typeof fetch;
}

interface InstallationTokenResponse {
  token: string;
  expiresAt?: string;
}

export async function cloneFromGithub(input: CloneInput): Promise<CloneResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!input.config.brokerBaseUrl) {
    return {
      ok: false,
      reason: "no-broker",
      detail: "GITHUB_APP_BROKER_URL is not configured. Sign-in works without it but cloning needs the broker.",
    };
  }

  // 1. Mint an installation token via the broker.
  let tokenRes: Response;
  try {
    tokenRes = await fetchImpl(
      `${input.config.brokerBaseUrl}/installations/${input.installationId}/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: input.callerOrigin,
        },
      }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "broker-unreachable",
      detail: (err as Error).message,
    };
  }

  const tokenBody = (await tokenRes.json().catch(() => ({}))) as Partial<InstallationTokenResponse> & {
    error?: string;
    code?: string;
    detail?: string;
  };

  if (!tokenRes.ok || typeof tokenBody.token !== "string") {
    const detail =
      typeof tokenBody.error === "string"
        ? `${tokenBody.code ? `[${tokenBody.code}] ` : ""}${tokenBody.error}${typeof tokenBody.detail === "string" ? ` — ${tokenBody.detail}` : ""}`
        : `HTTP ${tokenRes.status}`;
    return { ok: false, reason: "broker-token-failed", detail };
  }
  const installationToken = tokenBody.token;

  // 2. Resolve where this clone lives on disk.
  const cache = createRepoCache(input.stateStore);
  const baseDir = await cache.resolveBaseDir();
  const targetPath = cache.resolvePath(baseDir, input.owner, input.repo);

  // 3. Clone (or refresh).
  const alreadyExists = await cache.exists(targetPath);
  let freshlyCloned = false;

  if (!alreadyExists) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const cloneUrl = buildAuthedCloneUrl(installationToken, input.owner, input.repo);
    try {
      await getGitTransport().clone(cloneUrl, targetPath);
    } catch (err) {
      // Cleanup partial directory so the next attempt isn't blocked
      // by a half-cloned tree.
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        reason: "clone-failed",
        detail: scrubToken((err as Error).message, installationToken),
      };
    }

    // Scrub the token from `.git/config`. Without this the token
    // would persist in `[remote "origin"] url = https://x-access-token:...@github.com/...`
    // even after expiry, which is a footgun if the directory is
    // shared or backed up.
    try {
      await simpleGit(targetPath).remote([
        "set-url",
        "origin",
        `https://github.com/${input.owner}/${input.repo}.git`,
      ]);
    } catch (err) {
      // Non-fatal — we still completed the clone. Log loudly so a
      // future security review catches the residue.
      console.warn(
        `[github-clone] WARNING: failed to scrub token from .git/config in ${targetPath}: ${(err as Error).message}`
      );
    }

    await cache.ensureDir(targetPath); // seeds .tve-meta.json
    await cache.recordInstallation(targetPath, input.installationId);
    freshlyCloned = true;
  } else {
    // Existing checkout — make sure its meta has the installation_id
    // recorded. Older clones from before this feature shipped won't
    // have it, and the token-injecting transport needs it for push.
    await cache.recordInstallation(targetPath, input.installationId);
    // Existing checkout — best-effort fast-forward to keep it current.
    // Skip silently when the working tree is dirty or the upstream is
    // unreachable; the user can pull manually from the git panel.
    try {
      await getGitTransport().pull(targetPath, ["--ff-only"]);
    } catch (err) {
      console.warn(
        `[github-clone] pull --ff-only on existing checkout failed (continuing anyway): ${scrubToken((err as Error).message, installationToken)}`
      );
    }
  }

  // 4. Optional ref checkout. Default branch is what `git clone`
  //    leaves us on — no work needed unless the caller asked for a
  //    different ref.
  if (input.ref) {
    try {
      const status = await simpleGit(targetPath).status();
      if (status.current !== input.ref) {
        await simpleGit(targetPath).checkout(input.ref);
      }
    } catch (err) {
      return {
        ok: false,
        reason: "checkout-failed",
        detail: `Failed to check out ref '${input.ref}': ${(err as Error).message}`,
      };
    }
  }

  // 5. Install dependencies if needed. On a fresh clone there are no
  //    node_modules; on an existing checkout we re-install only if
  //    the lockfile changed since the last install (RepoCache tracks
  //    this via .tve-meta.json).
  const needsInstall = freshlyCloned || (await cache.needsInstall(targetPath));
  if (needsInstall) {
    console.log(`[github-clone] Installing dependencies in ${targetPath}…`);
    const installRes = await installDependencies(targetPath, {
      onLog: (line) => console.log(`[install] ${line}`),
    });
    if (!installRes.ok) {
      return {
        ok: false,
        reason: "install-failed",
        detail: `${installRes.packageManager ?? "npm"} install failed: ${installRes.errorTail ?? "unknown error"}`,
      };
    }
    console.log(
      `[github-clone] Install complete (${installRes.packageManager}, ${Math.round(installRes.durationMs / 1000)}s)`
    );
    // Persist the lockfile hash so we skip install on subsequent
    // opens of the same checkout (until the lockfile changes).
    await cache.recordLockHash(targetPath);
  }

  return { ok: true, path: targetPath, freshlyCloned };
}

function buildAuthedCloneUrl(token: string, owner: string, repo: string): string {
  // GitHub's documented App-installation clone format. The literal
  // username `x-access-token` is required.
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/** Replace any occurrence of the installation token in a string with a
 *  redaction marker. Used before logging clone errors — simple-git
 *  may include the full clone URL (token-bearing) in its message. */
function scrubToken(s: string, token: string): string {
  if (!token) return s;
  return s.split(token).join("***REDACTED***");
}
