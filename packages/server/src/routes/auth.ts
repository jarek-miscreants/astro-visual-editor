import { Router } from "express";
import crypto from "crypto";
import type { GithubAppConfig } from "../lib/github-app-config.js";
import type { StateStore } from "../services/state-store.js";

/**
 * OAuth flow:
 *
 *   GET /api/auth/github/start
 *     → 302 to https://github.com/login/oauth/authorize?...
 *
 *   GitHub
 *     → 302 to /api/auth/github/callback?code=...&state=...&installation_id=...
 *
 *   GET /api/auth/github/callback
 *     → POST {code} to {broker}/oauth/exchange
 *     → store user access token (state.db prefs key=`github_user_token`)
 *     → 302 back to the editor with ?signed_in=1
 *
 * Token persistence: in `cli` mode the token sits in `state.db` so it
 * survives `tsx watch` reloads (otherwise every server restart would
 * silently sign the user out). Desktop mode should move this to OS
 * keychain via `keytar` — captured in docs/follow-ups.md.
 */

interface SignedInState {
  accessToken: string;
  storedAt: number;
  expiresAt: number | null;
  user?: { login: string; id: number; avatarUrl: string | null };
  /** Captured from `?installation_id=` on the callback when GitHub
   *  redirects after install (vs sign-in only). Saved here so the
   *  repo picker can target it without a separate API round-trip. */
  installationId: number | null;
}

interface OauthState {
  createdAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_PREF_KEY = "github_user_token";

const oauthStates = new Map<string, OauthState>();
let signedIn: SignedInState | null = null;
let attachedStore: StateStore | null = null;

/** Wire the state store at server boot so token writes persist. The
 *  module also reads the pref synchronously during the initial load
 *  so subsequent /whoami calls don't see a brief "signed out" gap. */
export function attachAuthStateStore(store: StateStore): void {
  attachedStore = store;
  const persisted = store.getPref<SignedInState>(TOKEN_PREF_KEY);
  if (persisted) {
    // Drop expired tokens — GitHub will reject them anyway, and a
    // stale token in a fresh boot is a worse UX than a clean re-sign-in.
    if (persisted.expiresAt !== null && persisted.expiresAt <= Date.now()) {
      store.setPref(TOKEN_PREF_KEY, null);
      signedIn = null;
      return;
    }
    signedIn = persisted;
  }
}

function persistSignedIn(): void {
  if (!attachedStore) return;
  if (signedIn) attachedStore.setPref(TOKEN_PREF_KEY, signedIn);
  else attachedStore.setPref(TOKEN_PREF_KEY, null);
}

/** Periodic state cleanup. Cheap; runs on every /start. */
function pruneStates(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [key, value] of oauthStates) {
    if (value.createdAt < cutoff) oauthStates.delete(key);
  }
}

function getCallbackUrl(): string {
  const port = Number(process.env.PORT) || 3011;
  return `http://localhost:${port}/api/auth/github/callback`;
}

function getEditorUrl(): string {
  return process.env.TVE_EDITOR_URL || "http://localhost:3005";
}

export const authRouter = Router();

authRouter.get("/github/start", (req, res) => {
  const config = req.app.locals.githubAppConfig as GithubAppConfig | null;
  if (!config) {
    res.status(503).json({
      error: "GitHub App not configured on this server",
      code: "no-app-config",
    });
    return;
  }

  pruneStates();
  const state = crypto.randomBytes(32).toString("hex");
  oauthStates.set(state, { createdAt: Date.now() });

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", getCallbackUrl());
  authUrl.searchParams.set("state", state);

  res.redirect(authUrl.toString());
});

authRouter.get("/github/callback", async (req, res) => {
  const config = req.app.locals.githubAppConfig as GithubAppConfig | null;
  const { code, state, installation_id, error, error_description } = req.query;

  if (typeof error === "string") {
    sendError(
      res,
      400,
      `GitHub returned an error: ${
        typeof error_description === "string" ? error_description : error
      }`
    );
    return;
  }

  if (!config) {
    sendError(res, 503, "GitHub App not configured on this server.");
    return;
  }

  if (typeof code !== "string" || code.length === 0) {
    sendError(res, 400, "Callback missing `code` query parameter.");
    return;
  }

  // Without a broker URL we can confirm the upstream wiring works
  // without exchanging the code. Useful as a Phase 1 sanity check.
  // This path stores no token, so it carries no CSRF risk — it runs
  // before the mandatory state check below.
  if (!config.brokerBaseUrl) {
    sendDebugPage(
      res,
      `Broker URL is not configured (\`GITHUB_APP_BROKER_URL\` is unset).`,
      { code: String(code), installation_id, state }
    );
    return;
  }

  // CSRF: a sign-in callback MUST carry a `state` we issued at /start.
  // A missing or unknown state is either a stale link or a login-CSRF
  // attempt — an attacker feeding their own code to plant their token
  // in the victim's editor — so reject before exchanging/storing a
  // token. The direct-from-github.com install flow routes through the
  // App's Setup URL (= /start), so a real install carries a state too.
  if (
    typeof state !== "string" ||
    state.length === 0 ||
    !oauthStates.has(state)
  ) {
    sendError(
      res,
      400,
      "Invalid or expired sign-in state. Try signing in again."
    );
    return;
  }
  oauthStates.delete(state);

  let exchangeRes: Response;
  try {
    exchangeRes = await fetch(`${config.brokerBaseUrl}/oauth/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${process.env.PORT || 3011}`,
      },
      body: JSON.stringify({ code, redirectUri: getCallbackUrl() }),
    });
  } catch (err) {
    sendError(
      res,
      502,
      `Could not reach the token broker at ${config.brokerBaseUrl}: ${(err as Error).message}`
    );
    return;
  }

  const data = (await exchangeRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!exchangeRes.ok || typeof data.accessToken !== "string") {
    const detail =
      typeof data.error === "string"
        ? `${data.error}${typeof data.detail === "string" ? ` — ${data.detail}` : ""}`
        : `HTTP ${exchangeRes.status}`;
    sendError(res, 502, `Broker rejected the exchange: ${detail}`);
    return;
  }

  // Optional best-effort user lookup. If GitHub is briefly unreachable
  // this is non-fatal — the editor still has a token.
  let user: SignedInState["user"];
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${data.accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "tve-server",
      },
    });
    if (userRes.ok) {
      const userData = (await userRes.json()) as Record<string, unknown>;
      user = {
        login: String(userData.login),
        id: Number(userData.id),
        avatarUrl:
          typeof userData.avatar_url === "string"
            ? (userData.avatar_url as string)
            : null,
      };
    }
  } catch {
    // Non-fatal. Whoami can fill this in later.
  }

  const expiresIn =
    typeof data.expiresIn === "number" ? (data.expiresIn as number) : null;

  signedIn = {
    accessToken: data.accessToken,
    storedAt: Date.now(),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    user,
    installationId:
      typeof installation_id === "string" && installation_id.length > 0
        ? Number(installation_id)
        : null,
  };
  persistSignedIn();

  // Bounce back to the editor with a hint flag. The editor's auth
  // store reads /api/auth/whoami to confirm.
  const back = new URL(getEditorUrl());
  back.searchParams.set("signed_in", "1");
  if (user) back.searchParams.set("user", user.login);
  if (signedIn.installationId !== null) {
    back.searchParams.set("installation_id", String(signedIn.installationId));
  }
  res.redirect(back.toString());
});

authRouter.get("/whoami", (_req, res) => {
  if (!signedIn) {
    res.json({ signedIn: false });
    return;
  }
  res.json({
    signedIn: true,
    user: signedIn.user ?? null,
    installationId: signedIn.installationId,
    storedAt: signedIn.storedAt,
    expiresAt: signedIn.expiresAt,
  });
});

authRouter.post("/logout", (_req, res) => {
  signedIn = null;
  persistSignedIn();
  res.json({ signedIn: false });
});

/** Read the current token. Used by `/api/github/*` routes to call
 *  GitHub on behalf of the signed-in user. Returns null when signed
 *  out or the token has expired. */
export function getCurrentAccessToken(): string | null {
  if (!signedIn) return null;
  if (signedIn.expiresAt !== null && signedIn.expiresAt <= Date.now()) {
    // Expired — clear it so the next /whoami reflects reality.
    signedIn = null;
    persistSignedIn();
    return null;
  }
  return signedIn.accessToken;
}

/** Test-only hook: lets `routes/auth.test.ts` plant a token without
 *  going through the full OAuth dance. Not exposed via HTTP. */
export function _setSignedInForTesting(state: SignedInState | null): void {
  signedIn = state;
}

/** Test-only readback. Not exposed via HTTP. */
export function _getSignedInForTesting(): SignedInState | null {
  return signedIn;
}

function sendError(res: import("express").Response, status: number, message: string): void {
  res.status(status).type("html").send(renderHtmlPage(
    "Sign-in failed",
    `<p style="color:#b91c1c"><strong>${escapeHtml(message)}</strong></p>
     <p><a href="${escapeHtml(getEditorUrl())}">Return to editor</a></p>`
  ));
}

function sendDebugPage(
  res: import("express").Response,
  reason: string,
  fields: Record<string, unknown>
): void {
  const rows = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:.25rem .75rem;font-family:monospace;color:#71717a">${escapeHtml(k)}</td><td style="padding:.25rem .75rem;font-family:monospace">${escapeHtml(String(v))}</td></tr>`
    )
    .join("");
  res.status(200).type("html").send(renderHtmlPage(
    "Sign-in dry run",
    `<p>The OAuth callback fired correctly, but the token wasn't exchanged.</p>
     <p style="color:#71717a">${escapeHtml(reason)}</p>
     <table style="border-collapse:collapse;margin:1rem 0">${rows}</table>
     <p>Set <code>GITHUB_APP_BROKER_URL</code> in <code>.env.local</code> and try again to complete the flow.</p>
     <p><a href="${escapeHtml(getEditorUrl())}">Return to editor</a></p>`
  ));
}

function renderHtmlPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:3rem auto;padding:0 1.5rem;line-height:1.5;color:#18181b">
  <h1 style="font-size:1.5rem;font-weight:600">${escapeHtml(title)}</h1>
  ${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    const map: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c]!;
  });
}
