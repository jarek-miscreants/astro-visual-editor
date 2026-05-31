import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { getRecentProjects, addRecentProject } from "../services/recent-projects.js";
import { stopDevServer } from "../services/astro-dev-server.js";
import { validateLocalProject } from "../services/project-validator.js";
import { cloneFromGithub } from "../services/github-clone.js";
import type { GithubAppConfig } from "../lib/github-app-config.js";
import type { StateStore } from "../services/state-store.js";
import type { ProjectSwitchPayload, ProjectSwitchResponse } from "@tve/shared";

export const projectRouter = Router();

async function hasNodeModules(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, "node_modules"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Parse a `/switch` body into a `ProjectSwitchPayload`. Returns
 * `{ error, code }` on a shape problem so the route can surface a
 * targeted 400.
 *
 * Accepted shapes:
 *   - Legacy: `{ path: "/abs" }`               → { kind: "local", path }
 *   - New:    `{ kind: "local",  path }`        → as-is
 *   - New:    `{ kind: "github", owner, repo, ref? }` → as-is (501 in Phase 1)
 */
export function parseSwitchPayload(
  body: unknown
):
  | { ok: true; payload: ProjectSwitchPayload }
  | { ok: false; status: number; error: string; code: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "Body must be a JSON object", code: "invalid-body" };
  }
  const b = body as Record<string, unknown>;

  // Legacy shape: bare `{ path }` with no `kind`.
  if (typeof b.kind === "undefined") {
    if (typeof b.path !== "string" || b.path.length === 0) {
      return { ok: false, status: 400, error: "path is required", code: "invalid-payload" };
    }
    return { ok: true, payload: { kind: "local", path: b.path } };
  }

  if (b.kind === "local") {
    if (typeof b.path !== "string" || b.path.length === 0) {
      return { ok: false, status: 400, error: "path is required", code: "invalid-payload" };
    }
    return { ok: true, payload: { kind: "local", path: b.path } };
  }

  if (b.kind === "github") {
    if (typeof b.owner !== "string" || b.owner.length === 0) {
      return { ok: false, status: 400, error: "owner is required", code: "invalid-payload" };
    }
    if (typeof b.repo !== "string" || b.repo.length === 0) {
      return { ok: false, status: 400, error: "repo is required", code: "invalid-payload" };
    }
    if (typeof b.installationId !== "number" || !Number.isInteger(b.installationId) || b.installationId <= 0) {
      return { ok: false, status: 400, error: "installationId is required", code: "invalid-payload" };
    }
    const ref = typeof b.ref === "string" ? b.ref : undefined;
    return {
      ok: true,
      payload: {
        kind: "github",
        owner: b.owner,
        repo: b.repo,
        ref,
        installationId: b.installationId,
      },
    };
  }

  return {
    ok: false,
    status: 400,
    error: `Unknown kind '${String(b.kind)}'`,
    code: "invalid-kind",
  };
}

projectRouter.get("/info", (req, res) => {
  const p = req.app.locals.projectPath as string | null;
  const mode = (req.app.locals.mode as "cli" | "desktop" | undefined) ?? "cli";
  res.json({
    path: p,
    name: p ? path.basename(p) : null,
    mode,
  });
});

projectRouter.get("/recent", async (_req, res) => {
  const projects = await getRecentProjects();
  res.json({
    projects: projects.map((p) => ({ path: p, name: path.basename(p) })),
  });
});

projectRouter.post("/switch", async (req, res) => {
  try {
    const parsed = parseSwitchPayload(req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error, code: parsed.code });
      return;
    }
    const { payload } = parsed;

    let abs: string;
    let source: "local" | "github" = "local";

    if (payload.kind === "github") {
      const config = req.app.locals.githubAppConfig as GithubAppConfig | null;
      const stateStore = req.app.locals.stateStore as StateStore | null;
      if (!config) {
        res
          .status(503)
          .json({ error: "GitHub App not configured", code: "no-app-config" });
        return;
      }
      if (!stateStore) {
        res
          .status(503)
          .json({ error: "State store not ready", code: "no-state-store" });
        return;
      }
      const cloneRes = await cloneFromGithub({
        owner: payload.owner,
        repo: payload.repo,
        ref: payload.ref,
        installationId: payload.installationId,
        config,
        stateStore,
        callerOrigin: `http://localhost:${process.env.PORT || 3011}`,
      });
      if (!cloneRes.ok) {
        res
          .status(cloneRes.reason === "no-broker" ? 503 : 502)
          .json({ error: cloneRes.detail, code: cloneRes.reason });
        return;
      }
      abs = cloneRes.path;
      source = "github";
    } else {
      abs = path.resolve(payload.path);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        res.status(400).json({ error: "Path is not a directory" });
        return;
      }
    }

    const validation = await validateLocalProject(abs);
    if (!validation.ok) {
      res.status(400).json({
        error: validation.detail,
        code: validation.reason,
      });
      return;
    }

    const nmPresent = await hasNodeModules(abs);

    const switcher = req.app.locals.switchProject as
      | ((path: string) => Promise<void>)
      | undefined;
    if (!switcher) {
      res.status(500).json({ error: "switchProject not installed on app.locals" });
      return;
    }

    await switcher(abs);
    await addRecentProject(abs);

    const response: ProjectSwitchResponse = {
      path: abs,
      name: path.basename(abs),
      hasNodeModules: nmPresent,
      source,
    };
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to switch project" });
  }
});

// Triggered by the editor's "Exit" shortcut. Stops the Astro dev server,
// flushes the response, then exits the backend process. The CLI launcher
// (bin/tve.mjs) watches for backend exit and tears down the editor Vite
// server, so killing the backend kills the whole stack.
projectRouter.post("/exit", (_req, res) => {
  console.log("[TVE Server] Exit requested by editor — shutting down");
  stopDevServer();
  res.json({ success: true });
  setTimeout(() => process.exit(0), 200);
});
