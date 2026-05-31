/**
 * Single source of truth for the GitHub App identity TVE talks to.
 *
 * All values come from environment variables so the server binary is
 * registration-agnostic — the same build can run against the personal
 * test App today and the Miscreants-owned production App tomorrow with
 * a one-file `.env.local` swap. The accompanying invalidation guard in
 * `state-store.syncAppContext` clears app-bound rows when `appId`
 * changes, so a swap doesn't leak stale installation IDs.
 *
 * Secrets (client secret, private key) NEVER live in this module or in
 * any server env var. Those go directly into the Cloudflare Worker
 * (token broker) via `wrangler secret put`. The TVE server only ever
 * sees the broker URL and the public identifiers.
 */

export interface GithubAppConfig {
  /** Numeric App ID (e.g. 3625760). Public. */
  appId: number;
  /** Client ID (e.g. `Iv23li…`). Public. Used as the OAuth client_id. */
  clientId: string;
  /** App slug — the URL fragment in `github.com/apps/{slug}`. Public. */
  slug: string;
  /** User-facing install URL. Derived; included for convenience. */
  installUrl: string;
  /** Token broker base URL. `null` until the Cloudflare Worker is
   *  deployed; auth flows return a structured error instead of
   *  half-working when null. */
  brokerBaseUrl: string | null;
}

const ENV_KEYS = {
  appId: "GITHUB_APP_ID",
  clientId: "GITHUB_APP_CLIENT_ID",
  slug: "GITHUB_APP_SLUG",
  brokerBaseUrl: "GITHUB_APP_BROKER_URL",
} as const;

/**
 * Load and validate config from env. Returns `null` when none of the
 * three public values are set — the CLI dev flow doesn't touch GitHub,
 * so unset is a valid state. Throws on partial config (set some, miss
 * others) because that's almost certainly a misconfiguration the caller
 * wants to know about loudly.
 */
export function loadGithubAppConfig(
  env: NodeJS.ProcessEnv = process.env
): GithubAppConfig | null {
  const appIdRaw = env[ENV_KEYS.appId]?.trim() || undefined;
  const clientId = env[ENV_KEYS.clientId]?.trim() || undefined;
  const slug = env[ENV_KEYS.slug]?.trim() || undefined;
  const brokerBaseUrlRaw = env[ENV_KEYS.brokerBaseUrl]?.trim() || undefined;

  // All three public values unset → CLI / unconfigured. Fine.
  if (!appIdRaw && !clientId && !slug) return null;

  // Partial → mistake. Surface the missing names so the user can fix it
  // without grepping.
  const missing: string[] = [];
  if (!appIdRaw) missing.push(ENV_KEYS.appId);
  if (!clientId) missing.push(ENV_KEYS.clientId);
  if (!slug) missing.push(ENV_KEYS.slug);
  if (missing.length > 0) {
    throw new Error(
      `GitHub App config incomplete. Missing env var(s): ${missing.join(", ")}. Set all three together — or unset them all to disable GitHub mode.`
    );
  }

  const appId = Number(appIdRaw);
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error(
      `${ENV_KEYS.appId} must be a positive integer, got '${appIdRaw}'`
    );
  }

  // Slug + Client ID shape checks — light, only catches obvious paste
  // errors. We don't pretend to verify the credentials are *real*; the
  // broker exchange does that.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(slug!)) {
    throw new Error(
      `${ENV_KEYS.slug} '${slug}' is not a valid GitHub App slug (lowercase letters, digits, hyphens; no leading/trailing hyphen)`
    );
  }
  if (!/^[A-Za-z0-9]+$/.test(clientId!)) {
    throw new Error(
      `${ENV_KEYS.clientId} '${clientId}' contains non-alphanumeric characters — likely a paste error`
    );
  }

  let brokerBaseUrl: string | null = null;
  if (brokerBaseUrlRaw) {
    try {
      const parsed = new URL(brokerBaseUrlRaw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("must use http:// or https://");
      }
      // Strip trailing slash so callers can `${broker}/oauth/exchange`
      // without double-slash bugs.
      brokerBaseUrl = brokerBaseUrlRaw.replace(/\/+$/, "");
    } catch (err) {
      throw new Error(
        `${ENV_KEYS.brokerBaseUrl} '${brokerBaseUrlRaw}' is not a valid URL: ${(err as Error).message}`
      );
    }
  }

  return {
    appId,
    clientId: clientId!,
    slug: slug!,
    installUrl: `https://github.com/apps/${slug}/installations/new`,
    brokerBaseUrl,
  };
}
