import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { githubRouter } from "./github.js";
import { _setSignedInForTesting } from "./auth.js";

let server: Server;
let baseUrl: string;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

async function bootApp(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/github", githubRouter);
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  // Pass-through for test-server calls; intercept api.github.com
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
  if (server) await new Promise<void>((r) => server.close(() => r()));
  vi.restoreAllMocks();
});

function signIn(token = "ghu_test"): void {
  _setSignedInForTesting({
    accessToken: token,
    storedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
    user: { login: "octocat", id: 583231, avatarUrl: null },
    installationId: null,
  });
}

describe("GET /api/github/installations", () => {
  it("returns 401 with code='not-signed-in' when no token stored", async () => {
    await bootApp();
    const res = await fetch(`${baseUrl}/api/github/installations`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not-signed-in");
  });

  it("returns parsed installations on the happy path", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total_count: 1,
          installations: [
            {
              id: 130113952,
              account: {
                login: "jarek-miscreants",
                type: "User",
                avatar_url: "https://avatars/x.png",
              },
              repository_selection: "selected",
              permissions: { contents: "write", metadata: "read" },
            },
          ],
        }),
        { status: 200 }
      )
    );
    await bootApp();
    signIn();

    const res = await fetch(`${baseUrl}/api/github/installations`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      installations: Array<{ id: number; account: { login: string }; repositorySelection: string }>;
    };
    expect(body.installations).toHaveLength(1);
    expect(body.installations[0].id).toBe(130113952);
    expect(body.installations[0].account.login).toBe("jarek-miscreants");
    expect(body.installations[0].repositorySelection).toBe("selected");

    // Verify upstream was called with the right auth header
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/user/installations");
    expect(init.headers.Authorization).toBe("Bearer ghu_test");
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("propagates GitHub error status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("rate limit", { status: 403 })
    );
    await bootApp();
    signIn();

    const res = await fetch(`${baseUrl}/api/github/installations`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("github-error");
  });

  it("returns 502 when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await bootApp();
    signIn();

    const res = await fetch(`${baseUrl}/api/github/installations`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("github-unreachable");
  });

  it("handles empty installations list", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ total_count: 0, installations: [] }), {
        status: 200,
      })
    );
    await bootApp();
    signIn();

    const res = await fetch(`${baseUrl}/api/github/installations`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { installations: unknown[] };
    expect(body.installations).toEqual([]);
  });
});

describe("GET /api/github/installations/:id/repositories", () => {
  it("returns parsed repos with normalized fields", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total_count: 2,
          repositories: [
            {
              id: 1,
              name: "site",
              full_name: "acme/site",
              default_branch: "main",
              private: false,
              description: "Marketing site",
              html_url: "https://github.com/acme/site",
              pushed_at: "2026-04-01T00:00:00Z",
            },
            {
              id: 2,
              name: "internal",
              full_name: "acme/internal",
              default_branch: "trunk",
              private: true,
              description: null,
              html_url: "https://github.com/acme/internal",
              pushed_at: null,
            },
          ],
        }),
        { status: 200 }
      )
    );
    await bootApp();
    signIn();

    const res = await fetch(
      `${baseUrl}/api/github/installations/130113952/repositories`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repositories: Array<{
        id: number;
        fullName: string;
        defaultBranch: string;
        private: boolean;
      }>;
    };
    expect(body.repositories).toHaveLength(2);
    expect(body.repositories[0].fullName).toBe("acme/site");
    expect(body.repositories[0].defaultBranch).toBe("main");
    expect(body.repositories[1].private).toBe(true);
    expect(body.repositories[1].defaultBranch).toBe("trunk");

    // Upstream was called with per_page=100 and the right auth
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/user/installations/130113952/repositories?per_page=100"
    );
    expect(init.headers.Authorization).toBe("Bearer ghu_test");
  });

  it("returns 401 when not signed in", async () => {
    await bootApp();
    const res = await fetch(`${baseUrl}/api/github/installations/1/repositories`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid installation id", async () => {
    await bootApp();
    signIn();

    const res = await fetch(
      `${baseUrl}/api/github/installations/not-a-number/repositories`
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad-id");
  });

  it("returns 400 for installation id <= 0", async () => {
    await bootApp();
    signIn();

    const res = await fetch(
      `${baseUrl}/api/github/installations/0/repositories`
    );
    expect(res.status).toBe(400);
  });

  it("propagates 404 from GitHub (e.g. user has no access to that install)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    await bootApp();
    signIn();

    const res = await fetch(
      `${baseUrl}/api/github/installations/9999999/repositories`
    );
    expect(res.status).toBe(404);
  });
});
