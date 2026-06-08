import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import type { TveBranchConfig } from "@tve/shared";
import { requireEditorOrigin } from "../lib/require-editor-origin.js";
import { _setSignedInForTesting } from "./auth.js";

const gitMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getBranches: vi.fn(),
  getDiff: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  getRecentCommits: vi.fn(),
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  detectGitMode: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  ensureStaging: vi.fn(),
  promote: vi.fn(),
}));

vi.mock("../services/git.js", () => gitMocks);

import { gitRouter } from "./git.js";

let server: Server | null = null;
let baseUrl = "";

function baseConfig(overrides: Partial<TveBranchConfig> = {}): TveBranchConfig {
  return {
    branches: {
      production: "main",
      staging: "staging",
      draftPrefix: "tve/draft-",
      ...overrides.branches,
    },
    git: {
      autoCommitMode: "staged",
      ffOnly: true,
      deleteDraftAfterMerge: false,
      ...overrides.git,
    },
    publishing: {
      productionMode: "admins-only",
      defaultTarget: "staging",
      reviewBranchPrefix: "tve/review-",
      ...overrides.publishing,
    },
    roles: {
      admins: [],
      publishers: [],
      reviewers: [],
      ...overrides.roles,
    },
  };
}

async function bootApp(opts: { originGuard?: boolean } = {}): Promise<void> {
  const app = express();
  app.use(express.json());
  app.locals.projectPath = "C:\\repo";
  app.use(
    "/api/git",
    opts.originGuard === false ? gitRouter : [requireEditorOrigin, gitRouter]
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function requestJson(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  _setSignedInForTesting(null);
  gitMocks.getStatus.mockResolvedValue({ currentBranch: "feature" });
  gitMocks.readConfig.mockResolvedValue(baseConfig());
  gitMocks.writeConfig.mockResolvedValue(undefined);
  gitMocks.push.mockResolvedValue(undefined);
  gitMocks.promote.mockResolvedValue({ method: "fast-forward", pushed: true });
});

afterEach(async () => {
  _setSignedInForTesting(null);
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe("git route origin guard", () => {
  it("rejects browser cross-origin writes before push runs", async () => {
    await bootApp();

    const r = await requestJson("/api/git/push", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ branch: "feature" }),
    });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe("forbidden-origin");
    expect(gitMocks.push).not.toHaveBeenCalled();
  });
});

describe("production publish authorization", () => {
  it("rejects pushing the production branch when signed-in user is not an admin", async () => {
    await bootApp({ originGuard: false });
    gitMocks.readConfig.mockResolvedValue(
      baseConfig({ roles: { admins: ["owner"], publishers: [], reviewers: [] } })
    );
    _setSignedInForTesting({
      accessToken: "ghu_test",
      storedAt: Date.now(),
      expiresAt: null,
      user: { login: "intruder", id: 1, avatarUrl: null },
      installationId: null,
    });

    const r = await requestJson("/api/git/push", {
      method: "POST",
      body: JSON.stringify({ branch: "main" }),
    });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe("production-publish-forbidden");
    expect(gitMocks.push).not.toHaveBeenCalled();
  });

  it("rejects promoting into production when signed-in user is not an admin", async () => {
    await bootApp({ originGuard: false });
    gitMocks.readConfig.mockResolvedValue(
      baseConfig({ roles: { admins: ["owner"], publishers: [], reviewers: [] } })
    );
    _setSignedInForTesting({
      accessToken: "ghu_test",
      storedAt: Date.now(),
      expiresAt: null,
      user: { login: "intruder", id: 1, avatarUrl: null },
      installationId: null,
    });

    const r = await requestJson("/api/git/promote", {
      method: "POST",
      body: JSON.stringify({ from: "staging", to: "main" }),
    });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe("production-publish-forbidden");
    expect(gitMocks.promote).not.toHaveBeenCalled();
  });

  it("allows an admin to promote into production", async () => {
    await bootApp({ originGuard: false });
    gitMocks.readConfig.mockResolvedValue(
      baseConfig({ roles: { admins: ["github:owner"], publishers: [], reviewers: [] } })
    );
    _setSignedInForTesting({
      accessToken: "ghu_test",
      storedAt: Date.now(),
      expiresAt: null,
      user: { login: "OWNER", id: 1, avatarUrl: null },
      installationId: null,
    });

    const r = await requestJson("/api/git/promote", {
      method: "POST",
      body: JSON.stringify({ from: "staging", to: "main" }),
    });

    expect(r.status).toBe(200);
    expect(gitMocks.promote).toHaveBeenCalledWith("C:\\repo", {
      from: "staging",
      to: "main",
      ffOnly: undefined,
      push: undefined,
    });
  });

  it("preserves the local-dev fallback when no roles are configured", async () => {
    await bootApp({ originGuard: false });
    gitMocks.readConfig.mockResolvedValue(baseConfig());

    const r = await requestJson("/api/git/push", {
      method: "POST",
      body: JSON.stringify({ branch: "main" }),
    });

    expect(r.status).toBe(200);
    expect(gitMocks.push).toHaveBeenCalled();
  });

  it("does not restrict non-production branch pushes", async () => {
    await bootApp({ originGuard: false });
    gitMocks.readConfig.mockResolvedValue(
      baseConfig({ roles: { admins: ["owner"], publishers: [], reviewers: [] } })
    );

    const r = await requestJson("/api/git/push", {
      method: "POST",
      body: JSON.stringify({ branch: "feature" }),
    });

    expect(r.status).toBe(200);
    expect(gitMocks.push).toHaveBeenCalledWith("C:\\repo", {
      branch: "feature",
      setUpstream: false,
    });
  });
});

describe("PUT /api/git/config", () => {
  it("sanitizes role arrays before writing config to disk", async () => {
    await bootApp({ originGuard: false });
    gitMocks.readConfig.mockResolvedValue(
      baseConfig({
        roles: {
          admins: ["old-admin"],
          publishers: ["old-publisher"],
          reviewers: ["old-reviewer"],
        },
      })
    );

    const r = await requestJson("/api/git/config", {
      method: "PUT",
      body: JSON.stringify({
        roles: {
          admins: [null, " owner ", 123, {}, "", "@lead"],
          publishers: [null, "", "   "],
          reviewers: "not-an-array",
        },
      }),
    });

    expect(r.status).toBe(200);
    expect(gitMocks.writeConfig).toHaveBeenCalledTimes(1);
    expect(gitMocks.writeConfig.mock.calls[0][1].roles).toEqual({
      admins: ["owner", "@lead"],
      publishers: [],
      reviewers: ["old-reviewer"],
    });
  });
});
