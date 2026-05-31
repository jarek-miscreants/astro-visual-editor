import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { projectRouter, parseSwitchPayload } from "./project.js";

/**
 * Phase 1 step 8 contract:
 *
 *   - legacy `{ path }`               → 200 (kind=local)
 *   - new `{ kind:"local",  path }`   → 200 (identical to legacy)
 *   - new `{ kind:"github", ... }`    → 501 with code "phase2-github"
 *   - missing fields / bad kind       → 400 with a code field
 */

describe("parseSwitchPayload", () => {
  it("accepts the legacy `{ path }` shape as kind=local", () => {
    const r = parseSwitchPayload({ path: "/some/dir" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toEqual({ kind: "local", path: "/some/dir" });
  });

  it("accepts the new `{ kind:'local', path }` shape", () => {
    const r = parseSwitchPayload({ kind: "local", path: "/some/dir" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toEqual({ kind: "local", path: "/some/dir" });
  });

  it("accepts the new `{ kind:'github', owner, repo, installationId }` shape", () => {
    const r = parseSwitchPayload({
      kind: "github",
      owner: "acme",
      repo: "site",
      installationId: 130113952,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual({
        kind: "github",
        owner: "acme",
        repo: "site",
        ref: undefined,
        installationId: 130113952,
      });
    }
  });

  it("preserves `ref` on the github shape", () => {
    const r = parseSwitchPayload({
      kind: "github",
      owner: "acme",
      repo: "site",
      installationId: 1,
      ref: "feature-branch",
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.payload.kind === "github") {
      expect(r.payload.ref).toBe("feature-branch");
    }
  });

  it("rejects github without installationId", () => {
    const r = parseSwitchPayload({ kind: "github", owner: "acme", repo: "site" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe("invalid-payload");
    }
  });

  it("rejects github with non-positive installationId", () => {
    const r = parseSwitchPayload({
      kind: "github",
      owner: "acme",
      repo: "site",
      installationId: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid `kind` with code invalid-kind", () => {
    const r = parseSwitchPayload({ kind: "ftp", url: "..." });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe("invalid-kind");
    }
  });

  it("rejects local without path", () => {
    const r = parseSwitchPayload({ kind: "local" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects github without owner", () => {
    const r = parseSwitchPayload({ kind: "github", repo: "site" });
    expect(r.ok).toBe(false);
  });

  it("rejects github without repo", () => {
    const r = parseSwitchPayload({ kind: "github", owner: "acme" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-object bodies", () => {
    expect(parseSwitchPayload(null).ok).toBe(false);
    expect(parseSwitchPayload(undefined).ok).toBe(false);
    expect(parseSwitchPayload("string").ok).toBe(false);
    expect(parseSwitchPayload(42).ok).toBe(false);
  });
});

/**
 * End-to-end check against a real Express instance. We boot a tiny
 * project on disk so `validateLocalProject` returns ok=true without us
 * having to mock anything.
 */
describe("POST /api/project/switch", () => {
  let server: Server;
  let baseUrl: string;
  let projectDir: string;
  let switchProjectCalls: string[];

  beforeEach(async () => {
    // Minimal Astro+Tailwind project so validateLocalProject(abs) passes.
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-switch-route-"));
    await fs.writeFile(
      path.join(projectDir, "astro.config.mjs"),
      "export default {}",
      "utf-8"
    );
    await fs.writeFile(
      path.join(projectDir, "tailwind.config.mjs"),
      "export default {}",
      "utf-8"
    );

    const app = express();
    app.use(express.json());
    switchProjectCalls = [];
    app.locals.switchProject = async (p: string) => {
      switchProjectCalls.push(p);
    };
    app.use("/api/project", projectRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (projectDir) await fs.rm(projectDir, { recursive: true, force: true });
  });

  async function postSwitch(body: unknown) {
    const res = await fetch(`${baseUrl}/api/project/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }

  it("legacy { path } body switches successfully", async () => {
    const r = await postSwitch({ path: projectDir });
    expect(r.status).toBe(200);
    expect(r.json.source).toBe("local");
    expect(r.json.path).toBe(path.resolve(projectDir));
    expect(switchProjectCalls).toEqual([path.resolve(projectDir)]);
  });

  it("new { kind:'local', path } body switches identically", async () => {
    const r = await postSwitch({ kind: "local", path: projectDir });
    expect(r.status).toBe(200);
    expect(r.json.source).toBe("local");
    expect(r.json.path).toBe(path.resolve(projectDir));
  });

  it("github branch returns 503 no-app-config when GitHub App isn't configured on this server", async () => {
    // The test app doesn't set app.locals.githubAppConfig, so the
    // route correctly refuses to attempt a clone.
    const r = await postSwitch({
      kind: "github",
      owner: "acme",
      repo: "site",
      installationId: 1,
    });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("no-app-config");
    // Should not have called the project-switcher
    expect(switchProjectCalls).toEqual([]);
  });

  it("invalid kind returns 400 with code invalid-kind", async () => {
    const r = await postSwitch({ kind: "weird" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("invalid-kind");
  });

  it("local without path returns 400", async () => {
    const r = await postSwitch({ kind: "local" });
    expect(r.status).toBe(400);
  });

  it("legacy body without path returns 400", async () => {
    const r = await postSwitch({});
    expect(r.status).toBe(400);
  });

  it("local validation failure surfaces the validator's reason code", async () => {
    // Astro config exists, but no Tailwind anywhere — should fail
    // validateLocalProject with reason=no-tailwind.
    const noTw = await fs.mkdtemp(path.join(os.tmpdir(), "tve-no-tw-"));
    await fs.writeFile(
      path.join(noTw, "astro.config.mjs"),
      "export default {}",
      "utf-8"
    );
    try {
      const r = await postSwitch({ kind: "local", path: noTw });
      expect(r.status).toBe(400);
      expect(r.json.code).toBe("no-tailwind");
    } finally {
      await fs.rm(noTw, { recursive: true, force: true });
    }
  });
});
