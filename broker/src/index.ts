/**
 * TVE token broker. The single place GitHub App secrets live.
 *
 * Routes
 *   GET  /                        — health check
 *   POST /oauth/exchange          — swap an OAuth code for a user token
 *   POST /installations/:id/token — mint an installation access token
 *
 * Architecture context: phase-0-decisions.md §1 locks in "Option C" —
 * a hosted broker that holds the App's client secret + private key.
 * The TVE server (running on the user's machine) never sees these.
 *
 * The server invokes the broker over HTTPS. CORS isn't load-bearing
 * for the security model — server-to-broker is a backend call, not a
 * browser fetch — but the ALLOWED_ORIGINS gate is defense-in-depth
 * for browsers that might try to probe the broker directly.
 */

import { signAppJwt } from "./jwt.js";

export interface Env {
  /** Public — App's client ID. Baked into wrangler.toml `[vars]`. */
  GITHUB_APP_CLIENT_ID: string;
  /** Secret — App's client secret. `wrangler secret put GITHUB_APP_CLIENT_SECRET`. */
  GITHUB_APP_CLIENT_SECRET: string;
  /** Secret — App's PEM private key contents (BEGIN/END markers
   *  included). Required by `/installations/:id/token`. The OAuth
   *  exchange route works without this. */
  GITHUB_APP_PRIVATE_KEY?: string;
  /** Comma-separated list of origins allowed to call this broker.
   *  Defaults cover local dev. Extend for production. */
  ALLOWED_ORIGINS?: string;
}

interface ErrorBody {
  error: string;
  code: string;
  detail?: string;
}

const SECURITY_HEADERS: HeadersInit = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") ?? "";

    // CORS preflight — answer for any allowed origin.
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, isAllowedOrigin(origin, env)),
      });
    }

    // Health check — useful for `curl` smoke tests after deploy.
    if (req.method === "GET" && url.pathname === "/") {
      return jsonOk({ ok: true, service: "tve-broker" }, origin, env);
    }

    if (req.method === "POST" && url.pathname === "/oauth/exchange") {
      return handleOauthExchange(req, env, origin);
    }

    const installTokenMatch = url.pathname.match(
      /^\/installations\/(\d+)\/token$/
    );
    if (req.method === "POST" && installTokenMatch) {
      return handleInstallationToken(req, env, origin, installTokenMatch[1]);
    }

    return jsonError(
      404,
      { error: "Not Found", code: "not-found" },
      origin,
      env
    );
  },
};

async function handleOauthExchange(
  req: Request,
  env: Env,
  origin: string
): Promise<Response> {
  let body: { code?: unknown; redirectUri?: unknown };
  try {
    body = (await req.json()) as { code?: unknown; redirectUri?: unknown };
  } catch {
    return jsonError(
      400,
      { error: "Body must be valid JSON", code: "invalid-json" },
      origin,
      env
    );
  }

  if (typeof body.code !== "string" || body.code.length === 0) {
    return jsonError(
      400,
      { error: "code is required", code: "missing-code" },
      origin,
      env
    );
  }

  const exchangeBody: Record<string, string> = {
    client_id: env.GITHUB_APP_CLIENT_ID,
    client_secret: env.GITHUB_APP_CLIENT_SECRET,
    code: body.code,
  };
  // GitHub treats redirect_uri as optional for App OAuth, but if the
  // initial /authorize call sent one, this exchange must echo it.
  if (typeof body.redirectUri === "string" && body.redirectUri.length > 0) {
    exchangeBody.redirect_uri = body.redirectUri;
  }

  let ghRes: Response;
  try {
    ghRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        // GitHub looks at User-Agent in some flows.
        "User-Agent": "tve-broker",
      },
      body: JSON.stringify(exchangeBody),
    });
  } catch (err) {
    return jsonError(
      502,
      {
        error: "Failed to reach github.com",
        code: "github-unreachable",
        detail: (err as Error).message,
      },
      origin,
      env
    );
  }

  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    return jsonError(
      502,
      {
        error: `GitHub returned ${ghRes.status}`,
        code: "github-non-2xx",
        detail: text.slice(0, 500),
      },
      origin,
      env
    );
  }

  const data = (await ghRes.json().catch(() => ({}))) as Record<string, unknown>;

  // GitHub returns 200 with `error` field on rejection. Surface it
  // verbatim so the editor can show "code expired" vs "bad_verification_code".
  if (typeof data.error === "string") {
    return jsonError(
      400,
      {
        error: typeof data.error_description === "string"
          ? data.error_description
          : data.error,
        code: data.error,
      },
      origin,
      env
    );
  }

  const accessToken = data.access_token;
  if (typeof accessToken !== "string") {
    return jsonError(
      502,
      {
        error: "GitHub response missing access_token",
        code: "malformed-github-response",
      },
      origin,
      env
    );
  }

  // Pass through the relevant fields. Token rotation uses
  // refresh_token; user tokens expire ~8h.
  return jsonOk(
    {
      accessToken,
      tokenType: data.token_type,
      scope: data.scope,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token,
      refreshTokenExpiresIn: data.refresh_token_expires_in,
    },
    origin,
    env
  );
}

async function handleInstallationToken(
  req: Request,
  env: Env,
  origin: string,
  installationIdStr: string
): Promise<Response> {
  if (!env.GITHUB_APP_PRIVATE_KEY) {
    return jsonError(
      503,
      {
        error: "GITHUB_APP_PRIVATE_KEY is not configured on the broker",
        code: "no-private-key",
      },
      origin,
      env
    );
  }

  const installationId = Number(installationIdStr);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return jsonError(
      400,
      { error: "Invalid installation id", code: "bad-id" },
      origin,
      env
    );
  }

  // Caller MUST prove they are a user who actually has this
  // installation. `Origin` is not a security boundary (it's spoofable
  // by any non-browser caller), so without this check anyone who knows
  // the Worker URL could enumerate the small integer installation IDs
  // and mint write-scoped tokens for arbitrary repos. See
  // phase-2-plan.md §9.2 (the `user_not_authorized_for_installation`
  // contract).
  let body: { userToken?: unknown };
  try {
    body = (await req.json()) as { userToken?: unknown };
  } catch {
    return jsonError(
      400,
      { error: "Body must be valid JSON", code: "invalid-json" },
      origin,
      env
    );
  }
  const userToken = body.userToken;
  if (typeof userToken !== "string" || userToken.length === 0) {
    return jsonError(
      401,
      { error: "userToken is required", code: "missing-user-token" },
      origin,
      env
    );
  }

  let membershipRes: Response;
  try {
    membershipRes = await fetch(
      "https://api.github.com/user/installations?per_page=100",
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "tve-broker",
        },
      }
    );
  } catch (err) {
    return jsonError(
      502,
      {
        error: "Failed to reach github.com",
        code: "github-unreachable",
        detail: (err as Error).message,
      },
      origin,
      env
    );
  }
  if (membershipRes.status === 401) {
    return jsonError(
      401,
      { error: "User token is invalid or expired", code: "user-token-invalid" },
      origin,
      env
    );
  }
  if (!membershipRes.ok) {
    const text = await membershipRes.text().catch(() => "");
    return jsonError(
      502,
      {
        error: `GitHub returned ${membershipRes.status} verifying installation access`,
        code: "github-non-2xx",
        detail: text.slice(0, 500),
      },
      origin,
      env
    );
  }
  const membership = (await membershipRes.json().catch(() => ({}))) as {
    installations?: Array<{ id?: unknown }>;
  };
  const authorized = (membership.installations ?? []).some(
    (i) => Number(i.id) === installationId
  );
  if (!authorized) {
    return jsonError(
      403,
      {
        error: "User is not authorized for this installation",
        code: "user-not-authorized-for-installation",
      },
      origin,
      env
    );
  }

  let jwt: string;
  try {
    jwt = await signAppJwt(env.GITHUB_APP_PRIVATE_KEY, {
      issuer: env.GITHUB_APP_CLIENT_ID,
    });
  } catch (err) {
    return jsonError(
      500,
      {
        error: "Failed to sign App JWT",
        code: "jwt-sign-failed",
        detail: (err as Error).message,
      },
      origin,
      env
    );
  }

  let ghRes: Response;
  try {
    ghRes = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "tve-broker",
        },
      }
    );
  } catch (err) {
    return jsonError(
      502,
      {
        error: "Failed to reach github.com",
        code: "github-unreachable",
        detail: (err as Error).message,
      },
      origin,
      env
    );
  }

  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    return jsonError(
      ghRes.status >= 400 && ghRes.status < 500 ? ghRes.status : 502,
      {
        error: `GitHub returned ${ghRes.status}`,
        code: "github-non-2xx",
        detail: text.slice(0, 500),
      },
      origin,
      env
    );
  }

  const data = (await ghRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof data.token !== "string") {
    return jsonError(
      502,
      {
        error: "GitHub response missing token",
        code: "malformed-github-response",
      },
      origin,
      env
    );
  }

  return jsonOk(
    {
      token: data.token,
      expiresAt: data.expires_at,
      permissions: data.permissions,
      repositorySelection: data.repository_selection,
    },
    origin,
    env
  );
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS ?? "http://localhost:3011")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin);
}

function corsHeaders(origin: string, allowed: boolean): HeadersInit {
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonOk(body: unknown, origin: string, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
      ...corsHeaders(origin, isAllowedOrigin(origin, env)),
    },
  });
}

function jsonError(
  status: number,
  body: ErrorBody,
  origin: string,
  env: Env
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
      ...corsHeaders(origin, isAllowedOrigin(origin, env)),
    },
  });
}
