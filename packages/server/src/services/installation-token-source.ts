import { createRepoCache } from "./repo-cache.js";
import type { InstallationTokenSource } from "./git-transport.js";
import type { GithubAppConfig } from "../lib/github-app-config.js";
import type { StateStore } from "./state-store.js";

/**
 * `InstallationTokenSource` backed by the broker's
 * `POST /installations/:id/token` endpoint. Looks up the
 * installation_id for the given repo path from `.tve-meta.json`
 * (recorded by `cloneFromGithub` at clone time), then mints a token
 * via the broker and returns it.
 *
 * Tokens are cached in memory by installation_id, with a 60-second
 * safety margin before the broker-reported `expiresAt`. That matches
 * GitHub's documented 1-hour TTL for installation tokens — we'll
 * mint at most one token per installation per ~59 minutes per server
 * boot.
 *
 * Returns null when:
 *   - the repo isn't a TVE-managed clone (no `.tve-meta.json`, or no
 *     `installationId` recorded — happens for local-only repos or
 *     ones cloned before this feature shipped).
 *   - the broker URL isn't configured.
 *   - the broker call fails.
 *
 * In all those cases the token transport falls back to ambient git
 * auth, so existing local workflows keep working.
 */

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export function createBrokerInstallationTokenSource(
  config: GithubAppConfig,
  stateStore: StateStore,
  opts: {
    fetchImpl?: typeof fetch;
    safetyMarginMs?: number;
    /** Returns the signed-in user's access token, or null when signed
     *  out. The broker requires it to prove the caller actually has
     *  the installation before minting a write-scoped token. Without a
     *  user token we can't mint — the transport falls back to ambient
     *  git auth. */
    getUserToken?: () => string | null;
  } = {}
): InstallationTokenSource {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const safetyMarginMs = opts.safetyMarginMs ?? 60_000;
  const getUserToken = opts.getUserToken;
  const cache = createRepoCache(stateStore);
  const tokens = new Map<number, CachedToken>();

  return {
    async tokenFor(repoPath: string): Promise<string | null> {
      const entry = await cache.read(repoPath);
      if (!entry || !entry.installationId) return null;
      if (!config.brokerBaseUrl) return null;

      const installationId = entry.installationId;
      const now = Date.now();
      const cached = tokens.get(installationId);
      if (cached && cached.expiresAtMs - safetyMarginMs > now) {
        return cached.token;
      }

      const userToken = getUserToken ? getUserToken() : null;
      if (!userToken) {
        // Not signed in (or no provider wired) — can't authorize the
        // mint. Fall back to ambient git auth.
        return null;
      }

      let res: Response;
      try {
        res = await fetchImpl(
          `${config.brokerBaseUrl}/installations/${installationId}/token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: `http://localhost:${process.env.PORT || 3011}`,
            },
            body: JSON.stringify({ userToken }),
          }
        );
      } catch (err) {
        console.warn(
          `[installation-token-source] broker unreachable for installation ${installationId}: ${(err as Error).message}`
        );
        return null;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[installation-token-source] broker returned ${res.status} for installation ${installationId}: ${body.slice(0, 200)}`
        );
        return null;
      }

      const data = (await res.json().catch(() => ({}))) as {
        token?: unknown;
        expiresAt?: unknown;
      };
      if (typeof data.token !== "string") {
        console.warn(
          `[installation-token-source] broker response missing token for installation ${installationId}`
        );
        return null;
      }

      const expiresAtMs =
        typeof data.expiresAt === "string"
          ? new Date(data.expiresAt).getTime()
          : now + 50 * 60 * 1000; // fallback 50 min (under GitHub's 1 hr cap)

      tokens.set(installationId, { token: data.token, expiresAtMs });
      return data.token;
    },
  };
}
