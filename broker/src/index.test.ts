import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker, { type Env } from "./index.js";

const baseEnv: Env = {
  GITHUB_APP_CLIENT_ID: "Iv23liYBl4uHyTNnpQzO",
  GITHUB_APP_CLIENT_SECRET: "test-secret",
  ALLOWED_ORIGINS: "http://localhost:3011,http://localhost:3005",
};

const allowedOrigin = "http://localhost:3011";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /", () => {
  it("returns ok=true on the health check", async () => {
    const res = await worker.fetch(
      new Request("https://broker/", {
        headers: { Origin: allowedOrigin },
      }),
      baseEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("tve-broker");
  });
});

describe("OPTIONS preflight", () => {
  it("returns 204 with CORS headers for an allowed origin", async () => {
    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "OPTIONS",
        headers: {
          Origin: allowedOrigin,
          "Access-Control-Request-Method": "POST",
        },
      }),
      baseEnv
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
  });

  it("returns 204 with no CORS headers for a disallowed origin", async () => {
    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      baseEnv
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("POST /oauth/exchange", () => {
  it("happy path: forwards code to GitHub, returns access token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ghu_aaa",
          token_type: "bearer",
          scope: "",
          expires_in: 28800,
          refresh_token: "ghr_bbb",
          refresh_token_expires_in: 15897600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: allowedOrigin,
        },
        body: JSON.stringify({ code: "test-code-123" }),
      }),
      baseEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    expect(body.accessToken).toBe("ghu_aaa");
    expect(body.refreshToken).toBe("ghr_bbb");

    // Verify the upstream call used client_id + client_secret + code
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    expect(sent.client_id).toBe(baseEnv.GITHUB_APP_CLIENT_ID);
    expect(sent.client_secret).toBe(baseEnv.GITHUB_APP_CLIENT_SECRET);
    expect(sent.code).toBe("test-code-123");
  });

  it("forwards redirectUri when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ghu_x" }), { status: 200 })
    );

    await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: JSON.stringify({
          code: "x",
          redirectUri: "http://localhost:3011/api/auth/github/callback",
        }),
      }),
      baseEnv
    );

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.redirect_uri).toBe(
      "http://localhost:3011/api/auth/github/callback"
    );
  });

  it("returns 400 on missing code with code='missing-code'", async () => {
    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: JSON.stringify({}),
      }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing-code");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: "{ not json",
      }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid-json");
  });

  it("surfaces GitHub's error code (e.g. bad_verification_code) as 400", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: JSON.stringify({ code: "expired" }),
      }),
      baseEnv
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("bad_verification_code");
    expect(body.error).toMatch(/incorrect or expired/);
  });

  it("returns 502 when GitHub returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Bad Gateway", { status: 502 })
    );

    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: JSON.stringify({ code: "x" }),
      }),
      baseEnv
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("github-non-2xx");
  });

  it("returns 502 when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: JSON.stringify({ code: "x" }),
      }),
      baseEnv
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("github-unreachable");
    expect(body.detail).toContain("ECONNRESET");
  });

  it("returns 502 when GitHub responds 200 without an access_token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })
    );
    const res = await worker.fetch(
      new Request("https://broker/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
        body: JSON.stringify({ code: "x" }),
      }),
      baseEnv
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("malformed-github-response");
  });
});

describe("unknown routes", () => {
  it("returns 404 for an unknown path", async () => {
    const res = await worker.fetch(
      new Request("https://broker/nope", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: allowedOrigin },
      }),
      baseEnv
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not-found");
  });
});

// PKCS#8 RSA test key — generated for tests only, never used in
// production. Web Crypto's RSASSA-PKCS1-v1_5 needs PKCS#8 directly,
// so this exercises the non-wrap path. The PKCS#1 wrap path is
// covered separately via the `signAppJwt` unit test in jwt.test.ts.
const TEST_PKCS8_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFthjqU5BSPiZS
0OVTUetSEGgWRf7uXxRwwhB7pzdZD2H0+mNQemHXCmkjg5p0lyMIPPg4ZMwyRDB7
fH4ihoymLBTwqHlrNMFyLRnxzjQRPlBV6G9kRAmRlbCZkHVRzJYNlbB5NPNB4aFW
eowLp6cl19aMBAQ52eGrOHG/v+S8VhYHmaQ0JmGTGFi6XWvRY9k+BGlzVU0SUv55
EmDiEC3oEDEKBKxHWjxrAk5p8VRHUUIClJ4S9xgFR2NLBIUR5ll79lMdHe+atb20
imbn4zYj20VHO+hsfvvGYsoB5utBSt/jOabYSr/PZ1GsTeHAxWzzd5uj/Mw96gB7
Y9QCaQjDAgMBAAECggEAGIRAS2K0p/+ASg3v9YS6lN2nlhFcSb5q/kQYTRmFr59J
mw2AnE3ttqv64hfd2gCMFWcm2fLwS+6m5Lv6lMnzbGvDx0kLsx/EWupZYdUf8cGh
EVTgwhM7/DVAwczs8aKcWRm7L5K6cvCrXAEybFG6ddjW4xEM3NyrmBJsmYTaT5Bh
rvwEi0ZMiy4ZUR9oeS3eU/JREOC52u6RVhMOY79HOd0MutCm74ME3Yz0Ad0NlS4U
g8qUGLWrTuQPzA9JEZQqQHgg9xSrVfQ7dBLqaRijNALZQK9k1YhMlD2CbEFNcvpY
7jpjvm9Iyr0ICVCT+4Qf/QH4DHEWpypcnpqf2ZjZkQKBgQDsK/FB91w76i0c0Auv
JXXmd3J63V3xgtuPv0PyXUCiZmLJUxnu5hqAG/bjlIEf5fY3W1Bn7FqGtYPWqUe7
Y+7NbTPEOH0IzhoRhmqJ1sAbsqmeMvb8R9CuSSWzL7PAB0FU/hf0YEX5aiK1gNGh
/o6Ch11BFsxlCo+gOlDi+/ll0wKBgQDV7/9VDX2h2xgpXxe2Q5O/zaaNPLrQRjbi
tbzyyGwGMwjLzBkQJMFc7VC2nbAfAfvATfzJaAYCOVvHaeUJ9SBy/2hf9RKO+y8m
xaZ5DgCEX//rVemKeAg7w6sMLevNyNoGBeAJNbk9lOjr8ehQc1nRgKnyT4bfexWk
yKE38qQjEQKBgQC5fvfA6h28zkhTlqNHiBivtmtZmCWsFnQsa4FbPbsSeHSvbHqJ
mNNfhXAF6NZiFnUZB87m4WWhXTrgKO4LpaIoiTmh1SWy/AEhTawMr0OagWEd4ScD
OTdfqK9BErH1zXf69zCC99w7E6Q2rGwoSt6FFRDiWyRZ5tOGl98TX0Ok0wKBgB4u
yOyvwJrmIGUjMIyUUKTvVWS4rJsdNHe6Pt2NfH5YhXIvRsnXTokAiLE1AvFV3FHV
aYhpzhBxh7gbMmw3ksMKXVpmrFkhUsMdOlj3NGvRq4tEeqHo0G1WGxxFf/cZcQQH
J8XX7gShkZuf0Y2v6lpe5UlFOA2k0LsIqv4t1UoBAoGAMeaNw4/Xg/9NNW1OntDP
hfg1d2Qi/4t6ePDbuY1QXGOaGSxh1/Sul3R32SO++bjTFhWk9eX2HJshPZi8KqEW
gMdHF9pSdq64sVeGxxFr4E2ELHgkFvgi8s2HfdaQJZP67D3zkgjcYTKvzEhGyEzj
OAwT/VuJhFTYOlvvqrs2xN0=
-----END PRIVATE KEY-----`;

describe("POST /installations/:id/token", () => {
  const userBody = JSON.stringify({ userToken: "ghu_user" });
  const withKey = { ...baseEnv, GITHUB_APP_PRIVATE_KEY: TEST_PKCS8_KEY };
  const jsonHeaders = {
    Origin: allowedOrigin,
    "Content-Type": "application/json",
  };

  /** A GitHub `/user/installations` response granting `ids`. */
  function membership(ids: number[]): Response {
    return new Response(
      JSON.stringify({ installations: ids.map((id) => ({ id })) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  it("returns 503 when GITHUB_APP_PRIVATE_KEY is not configured", async () => {
    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      baseEnv // no GITHUB_APP_PRIVATE_KEY
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("no-private-key");
  });

  it("returns 404 for a non-digit installation id (route regex)", async () => {
    const res = await worker.fetch(
      new Request("https://broker/installations/not-a-number/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 with missing-user-token when no userToken is supplied", async () => {
    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),
      withKey
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing-user-token");
    // Never touched GitHub.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 user-token-invalid when GitHub rejects the user token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("user-token-invalid");
    // Membership checked; mint never attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when the user lacks access to the installation", async () => {
    fetchMock.mockResolvedValueOnce(membership([42, 99]));
    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("user-not-authorized-for-installation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("happy path: verifies membership, signs JWT, returns minted token", async () => {
    fetchMock.mockResolvedValueOnce(membership([130113952]));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: "ghs_minted",
          expires_at: "2026-05-07T01:00:00Z",
          permissions: { contents: "write", metadata: "read" },
          repository_selection: "selected",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      expiresAt: string;
      permissions: Record<string, string>;
    };
    expect(body.token).toBe("ghs_minted");
    expect(body.expiresAt).toBe("2026-05-07T01:00:00Z");
    expect(body.permissions.contents).toBe("write");

    // First call = membership check, second = mint.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [membershipUrl] = fetchMock.mock.calls[0];
    expect(membershipUrl).toBe(
      "https://api.github.com/user/installations?per_page=100"
    );
    const [mintUrl, mintInit] = fetchMock.mock.calls[1];
    expect(mintUrl).toBe(
      "https://api.github.com/app/installations/130113952/access_tokens"
    );
    expect(mintInit.method).toBe("POST");
    // JWT header is three base64url-encoded segments separated by `.`
    expect(mintInit.headers.Authorization).toMatch(
      /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
  });

  it("propagates a GitHub 404 from the mint step (e.g. install removed)", async () => {
    fetchMock.mockResolvedValueOnce(membership([9999999]));
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const res = await worker.fetch(
      new Request("https://broker/installations/9999999/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("github-non-2xx");
  });

  it("returns 502 when the membership-check fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("github-unreachable");
  });

  it("returns 502 on a malformed mint response (no token)", async () => {
    fetchMock.mockResolvedValueOnce(membership([130113952]));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: "shape" }), { status: 201 })
    );
    const res = await worker.fetch(
      new Request("https://broker/installations/130113952/token", {
        method: "POST",
        headers: jsonHeaders,
        body: userBody,
      }),
      withKey
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("malformed-github-response");
  });
});
