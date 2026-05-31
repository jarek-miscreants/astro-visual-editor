import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createBrokerInstallationTokenSource } from "./installation-token-source.js";
import { createStateStore, type StateStore } from "./state-store.js";
import { createRepoCache } from "./repo-cache.js";
import type { GithubAppConfig } from "../lib/github-app-config.js";

let tmpHome: string;
let store: StateStore;
let originalTveHome: string | undefined;

const config: GithubAppConfig = {
  appId: 3625760,
  clientId: "Iv23liYBl4uHyTNnpQzO",
  slug: "tailwind-visual-editor",
  installUrl:
    "https://github.com/apps/tailwind-visual-editor/installations/new",
  brokerBaseUrl: "https://broker.example.com",
};

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "tve-install-token-"));
  originalTveHome = process.env.TVE_HOME;
  process.env.TVE_HOME = tmpHome;

  store = createStateStore({
    dbPath: path.join(tmpHome, "state.db"),
    legacyJsonPaths: [],
  });
  await store.open();
});

afterEach(async () => {
  store.close();
  if (originalTveHome === undefined) delete process.env.TVE_HOME;
  else process.env.TVE_HOME = originalTveHome;
  if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
});

async function seedClone(installationId: number | null): Promise<string> {
  const cache = createRepoCache(store);
  const baseDir = await cache.resolveBaseDir();
  const repoPath = cache.resolvePath(baseDir, "acme", "site");
  await cache.ensureDir(repoPath);
  if (installationId !== null) {
    await cache.recordInstallation(repoPath, installationId);
  }
  return repoPath;
}

describe("createBrokerInstallationTokenSource", () => {
  it("returns null for a path that isn't a TVE clone", async () => {
    const fetchImpl = vi.fn();
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });
    const token = await source.tokenFor(path.join(tmpHome, "not-a-clone"));
    expect(token).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when the clone has no recorded installationId", async () => {
    const repoPath = await seedClone(null);
    const fetchImpl = vi.fn();
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });
    expect(await source.tokenFor(repoPath)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when broker URL isn't configured", async () => {
    const repoPath = await seedClone(130113952);
    const fetchImpl = vi.fn();
    const source = createBrokerInstallationTokenSource(
      { ...config, brokerBaseUrl: null },
      store,
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(await source.tokenFor(repoPath)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls broker and returns the minted token", async () => {
    const repoPath = await seedClone(130113952);
    const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ token: "ghs_xxx", expiresAt: futureExpiry }),
        { status: 200 }
      )
    );
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });

    const token = await source.tokenFor(repoPath);
    expect(token).toBe("ghs_xxx");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://broker.example.com/installations/130113952/token");
    expect(init.method).toBe("POST");
    // The broker requires the user token to authorize the mint.
    expect(JSON.parse(init.body as string).userToken).toBe("ghu_user");
  });

  it("returns null when signed out (no user token to authorize the mint)", async () => {
    const repoPath = await seedClone(130113952);
    const fetchImpl = vi.fn();
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => null,
    });
    expect(await source.tokenFor(repoPath)).toBeNull();
    // Never calls the broker without a user token.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches tokens by installation_id within the safety window", async () => {
    const repoPath = await seedClone(130113952);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "ghs_first",
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
        { status: 200 }
      )
    );
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });

    const t1 = await source.tokenFor(repoPath);
    const t2 = await source.tokenFor(repoPath);
    expect(t1).toBe("ghs_first");
    expect(t2).toBe("ghs_first");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached
  });

  it("re-mints when the cached token is within the safety margin of expiry", async () => {
    const repoPath = await seedClone(130113952);
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: "ghs_about_to_expire",
          // Expires 30s from now — within the default 60s margin.
          expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
        }),
        { status: 200 }
      )
    );
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: "ghs_fresh",
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
        { status: 200 }
      )
    );
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });

    const t1 = await source.tokenFor(repoPath);
    const t2 = await source.tokenFor(repoPath);
    expect(t1).toBe("ghs_about_to_expire");
    expect(t2).toBe("ghs_fresh");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null when broker returns non-2xx (e.g. private key not set)", async () => {
    const repoPath = await seedClone(130113952);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "no-private-key", code: "no-private-key" }),
        { status: 503 }
      )
    );
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });
    expect(await source.tokenFor(repoPath)).toBeNull();
  });

  it("returns null when fetch itself throws (network error)", async () => {
    const repoPath = await seedClone(130113952);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const source = createBrokerInstallationTokenSource(config, store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getUserToken: () => "ghu_user",
    });
    expect(await source.tokenFor(repoPath)).toBeNull();
  });
});
