import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import {
  authRouter,
  attachAuthStateStore,
  getCurrentAccessToken,
  _setSignedInForTesting,
  _getSignedInForTesting,
} from "./auth.js";
import { createStateStore, type StateStore } from "../services/state-store.js";
import type { GithubAppConfig } from "../lib/github-app-config.js";

const goodConfig: GithubAppConfig = {
  appId: 3625760,
  clientId: "Iv23liYBl4uHyTNnpQzO",
  slug: "tailwind-visual-editor",
  installUrl:
    "https://github.com/apps/tailwind-visual-editor/installations/new",
  brokerBaseUrl: "https://broker.example.com",
};

let server: Server;
let baseUrl: string;
let fetchMock: ReturnType<typeof vi.fn>;

function bootApp(config: GithubAppConfig | null): Promise<void> {
  const app = express();
  app.use(express.json());
  app.locals.githubAppConfig = config;
  app.use("/api/auth", authRouter);
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  // Pass-through for calls to the test server (127.0.0.1); intercept
  // everything else (broker, GitHub API). This is the only way to test
  // a route over real HTTP without poisoning the test client's own
  // fetch() calls.
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost:")) {
      return realFetch(input, init);
    }
    return (fetchMock as unknown as (i: any, n?: any) => Promise<Response>)(input, init);
  }) as typeof fetch;
  _setSignedInForTesting(null);
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server.close(() => r()));
  }
  vi.restoreAllMocks();
});

describe("GET /api/auth/github/start", () => {
  it("redirects to github.com/login/oauth/authorize with the right query", async () => {
    await bootApp(goodConfig);
    const res = await fetch(`${baseUrl}/api/auth/github/start`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith("https://github.com/login/oauth/authorize")).toBe(true);
    const u = new URL(loc);
    expect(u.searchParams.get("client_id")).toBe(goodConfig.clientId);
    expect(u.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/localhost:\d+\/api\/auth\/github\/callback$/
    );
    expect(u.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns 503 with code=no-app-config when config is missing", async () => {
    await bootApp(null);
    const res = await fetch(`${baseUrl}/api/auth/github/start`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("no-app-config");
  });
});

describe("GET /api/auth/github/callback", () => {
  it("happy path — exchanges code via broker and stores token", async () => {
    fetchMock.mockResolvedValueOnce(
      // Broker exchange
      new Response(JSON.stringify({ accessToken: "ghu_test" }), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(
      // GitHub /user lookup
      new Response(
        JSON.stringify({
          login: "octocat",
          id: 583231,
          avatar_url: "https://avatars/x.png",
        }),
        { status: 200 }
      )
    );
    await bootApp(goodConfig);

    // Pull a state by hitting /start first (so the callback's state
    // validation succeeds against a known-good value)
    const startRes = await fetch(`${baseUrl}/api/auth/github/start`, {
      redirect: "manual",
    });
    const state = new URL(startRes.headers.get("location")!).searchParams.get(
      "state"
    )!;

    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=test-code&state=${state}&installation_id=130113952`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/signed_in=1/);
    expect(res.headers.get("location")).toMatch(/installation_id=130113952/);

    // Broker called with the right payload
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [brokerUrl, brokerInit] = fetchMock.mock.calls[0];
    expect(brokerUrl).toBe("https://broker.example.com/oauth/exchange");
    const body = JSON.parse(brokerInit.body as string);
    expect(body.code).toBe("test-code");

    // Signed-in state captured
    const stored = _getSignedInForTesting();
    expect(stored).not.toBeNull();
    expect(stored!.accessToken).toBe("ghu_test");
    expect(stored!.user?.login).toBe("octocat");
    expect(stored!.installationId).toBe(130113952);
  });

  it("rejects a sign-in callback that carries no state (login-CSRF guard)", async () => {
    await bootApp(goodConfig);

    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=c&installation_id=42`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/Invalid or expired sign-in state/i);
    // No token stored and the broker was never called.
    expect(_getSignedInForTesting()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown state value", async () => {
    await bootApp(goodConfig);
    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=c&state=not-a-real-state`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/Invalid or expired sign-in state/i);
    expect(_getSignedInForTesting()).toBeNull();
  });

  it("shows debug page when broker URL is unset (still useful for App-side smoke test)", async () => {
    await bootApp({ ...goodConfig, brokerBaseUrl: null });
    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=abc123&installation_id=42`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/Sign-in dry run/);
    expect(text).toMatch(/abc123/);
    expect(text).toMatch(/42/);
    expect(_getSignedInForTesting()).toBeNull();
  });

  it("surfaces broker error code in the rendered error page", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "The code passed is incorrect or expired.",
          code: "bad_verification_code",
        }),
        { status: 400 }
      )
    );
    await bootApp(goodConfig);
    // A valid state is now mandatory before the broker exchange runs.
    const startRes = await fetch(`${baseUrl}/api/auth/github/start`, {
      redirect: "manual",
    });
    const state = new URL(startRes.headers.get("location")!).searchParams.get(
      "state"
    )!;
    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?code=expired&state=${state}`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/incorrect or expired/);
  });

  it("surfaces a missing-code 400", async () => {
    await bootApp(goodConfig);
    const res = await fetch(`${baseUrl}/api/auth/github/callback`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/missing `code`/i);
  });

  it("propagates GitHub error= query param", async () => {
    await bootApp(goodConfig);
    const res = await fetch(
      `${baseUrl}/api/auth/github/callback?error=access_denied&error_description=The+user+denied+the+request`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/user denied/);
  });
});

describe("GET /api/auth/whoami", () => {
  it("returns signedIn=false when nothing's stored", async () => {
    await bootApp(goodConfig);
    const res = await fetch(`${baseUrl}/api/auth/whoami`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signedIn: boolean };
    expect(body.signedIn).toBe(false);
  });

  it("returns user details when signed in", async () => {
    await bootApp(goodConfig);
    _setSignedInForTesting({
      accessToken: "ghu_test",
      storedAt: 1700000000000,
      expiresAt: null,
      user: { login: "octocat", id: 583231, avatarUrl: null },
      installationId: 130113952,
    });
    const res = await fetch(`${baseUrl}/api/auth/whoami`);
    const body = (await res.json()) as {
      signedIn: boolean;
      user: { login: string };
      installationId: number;
    };
    expect(body.signedIn).toBe(true);
    expect(body.user.login).toBe("octocat");
    expect(body.installationId).toBe(130113952);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears signed-in state", async () => {
    await bootApp(goodConfig);
    _setSignedInForTesting({
      accessToken: "ghu_x",
      storedAt: 0,
      expiresAt: null,
      installationId: null,
    });
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(_getSignedInForTesting()).toBeNull();
  });
});

describe("token persistence (state.db)", () => {
  let tmpDir: string;
  let store: StateStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-auth-persist-"));
    store = createStateStore({
      dbPath: path.join(tmpDir, "state.db"),
      legacyJsonPaths: [],
    });
    await store.open();
  });

  afterEach(async () => {
    store.close();
    _setSignedInForTesting(null);
    // Detach from the module-level singleton so subsequent tests don't
    // see this store. attachAuthStateStore overwrites; passing a fresh
    // empty store accomplishes the same thing for cleanup.
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("attachAuthStateStore loads a previously-persisted token", async () => {
    // Pre-seed the store with a token (simulating a previous server run).
    store.setPref("github_user_token", {
      accessToken: "ghu_persisted",
      storedAt: Date.now(),
      expiresAt: Date.now() + 3600 * 1000,
      user: { login: "octocat", id: 583231, avatarUrl: null },
      installationId: 130113952,
    });

    attachAuthStateStore(store);

    const stored = _getSignedInForTesting();
    expect(stored).not.toBeNull();
    expect(stored!.accessToken).toBe("ghu_persisted");
    expect(stored!.user?.login).toBe("octocat");
  });

  it("drops a persisted token whose expiresAt is in the past", async () => {
    store.setPref("github_user_token", {
      accessToken: "ghu_expired",
      storedAt: Date.now() - 9 * 3600 * 1000,
      expiresAt: Date.now() - 3600 * 1000, // expired 1h ago
      user: { login: "octocat", id: 583231, avatarUrl: null },
      installationId: null,
    });

    attachAuthStateStore(store);

    expect(_getSignedInForTesting()).toBeNull();
    expect(store.getPref("github_user_token")).toBeNull();
  });

  it("ignores expiresAt=null (no expiry implies still valid)", async () => {
    store.setPref("github_user_token", {
      accessToken: "ghu_perpetual",
      storedAt: Date.now(),
      expiresAt: null,
      user: { login: "u", id: 1, avatarUrl: null },
      installationId: null,
    });

    attachAuthStateStore(store);

    expect(_getSignedInForTesting()?.accessToken).toBe("ghu_perpetual");
  });

  it("getCurrentAccessToken returns null when expired and clears the pref", async () => {
    attachAuthStateStore(store);
    _setSignedInForTesting({
      accessToken: "ghu_expiring",
      storedAt: 0,
      // Set expired but non-null so getCurrentAccessToken's check fires
      expiresAt: Date.now() - 1,
      installationId: null,
    });

    const token = getCurrentAccessToken();
    expect(token).toBeNull();
    expect(_getSignedInForTesting()).toBeNull();
  });

  it("getCurrentAccessToken returns the token when valid", async () => {
    attachAuthStateStore(store);
    _setSignedInForTesting({
      accessToken: "ghu_fresh",
      storedAt: Date.now(),
      expiresAt: Date.now() + 3600 * 1000,
      installationId: null,
    });
    expect(getCurrentAccessToken()).toBe("ghu_fresh");
  });
});
