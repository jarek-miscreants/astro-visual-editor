import { Router } from "express";
import {
  getStatus,
  getBranches,
  getDiff,
  commit,
  push,
  pull,
  getRecentCommits,
  readConfig,
  writeConfig,
  detectGitMode,
  checkoutBranch,
  createBranch,
  ensureStaging,
  promote,
} from "../services/git.js";
import { getCurrentAuthIdentity } from "./auth.js";
import type { TveBranchConfig } from "@tve/shared";

export const gitRouter = Router();

function requireProject(req: any, res: any): string | null {
  const projectPath = req.app.locals.projectPath as string | null;
  if (!projectPath) {
    res.status(400).json({ error: "No project is open" });
    return null;
  }
  return projectPath;
}

function sanitizeRoleList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRoleEntry(entry: string): string {
  return entry.trim().replace(/^github:/i, "").replace(/^@/, "").toLowerCase();
}

function roleMatches(entries: string[], githubLogin: string | null): boolean {
  if (!githubLogin) return false;
  const login = normalizeRoleEntry(githubLogin);
  return entries.some((entry) => {
    const normalized = normalizeRoleEntry(entry);
    return normalized === "*" || normalized === login;
  });
}

function roleConfigEmpty(config: TveBranchConfig): boolean {
  return (
    config.roles.admins.length === 0 &&
    config.roles.publishers.length === 0 &&
    config.roles.reviewers.length === 0
  );
}

function canPublishToProduction(config: TveBranchConfig): boolean {
  const identity = getCurrentAuthIdentity();
  switch (config.publishing.productionMode) {
    case "anyone":
      return true;
    case "any-signed-in":
      return identity.signedIn;
    case "admins-only":
    default:
      // Preserve local/dev projects with no configured role policy.
      if (roleConfigEmpty(config)) return true;
      return roleMatches(config.roles.admins, identity.login);
  }
}

async function requireProductionPublishAccess(
  projectPath: string,
  targetBranch: string,
  res: any
): Promise<boolean> {
  const config = await readConfig(projectPath);
  if (targetBranch !== config.branches.production) return true;
  if (canPublishToProduction(config)) return true;

  res.status(403).json({
    error: `Not authorized to publish to ${config.branches.production}`,
    code: "production-publish-forbidden",
  });
  return false;
}

gitRouter.get("/status", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const status = await getStatus(projectPath);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to read git status" });
  }
});

gitRouter.get("/branches", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const mode = await detectGitMode(projectPath);
    if (mode === "no-git") {
      res.json({ branches: [] });
      return;
    }
    const branches = await getBranches(projectPath);
    res.json({ branches });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to list branches" });
  }
});

gitRouter.get("/diff", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const diff = await getDiff(projectPath);
    res.json({ diff });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to compute diff" });
  }
});

gitRouter.get("/commits", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const commits = await getRecentCommits(projectPath, limit);
    res.json({ commits });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to list commits" });
  }
});

gitRouter.post("/commit", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = req.body as { message?: string; files?: string[] };
    if (!body?.message || typeof body.message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const result = await commit(projectPath, {
      message: body.message,
      files: Array.isArray(body.files) ? body.files : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Commit failed" });
  }
});

gitRouter.post("/push", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = (req.body || {}) as { branch?: string; setUpstream?: boolean };
    const branch =
      typeof body.branch === "string"
        ? body.branch
        : (await getStatus(projectPath)).currentBranch;
    if (branch && !(await requireProductionPublishAccess(projectPath, branch, res))) {
      return;
    }
    await push(projectPath, {
      branch: typeof body.branch === "string" ? body.branch : undefined,
      setUpstream: !!body.setUpstream,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Push failed" });
  }
});

gitRouter.post("/pull", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = (req.body || {}) as { mode?: string; branch?: string };
    const mode =
      body.mode === "merge" || body.mode === "rebase" ? body.mode : "ff-only";
    await pull(projectPath, {
      mode: mode as "ff-only" | "merge" | "rebase",
      branch: typeof body.branch === "string" ? body.branch : undefined,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Pull failed" });
  }
});

gitRouter.get("/config", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const config = await readConfig(projectPath);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to read .tve/config.json" });
  }
});

gitRouter.post("/checkout", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = req.body as { branch?: string };
    if (!body?.branch || typeof body.branch !== "string") {
      res.status(400).json({ error: "branch is required" });
      return;
    }
    await checkoutBranch(projectPath, body.branch);
    res.json({ success: true });
  } catch (err: any) {
    res.status(409).json({ error: err?.message || "Checkout failed" });
  }
});

gitRouter.post("/branch", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = req.body as { name?: string; from?: string; checkout?: boolean };
    if (!body?.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    await createBranch(projectPath, {
      name: body.name,
      fromBranch: typeof body.from === "string" ? body.from : undefined,
      checkout: body.checkout ?? true,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to create branch" });
  }
});

gitRouter.post("/ensure-staging", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const result = await ensureStaging(projectPath);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to set up staging branch" });
  }
});

gitRouter.post("/promote", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = req.body as { from?: string; to?: string; ffOnly?: boolean; push?: boolean };
    if (!body?.from || !body?.to) {
      res.status(400).json({ error: "from and to are required" });
      return;
    }
    if (!(await requireProductionPublishAccess(projectPath, body.to, res))) {
      return;
    }
    const result = await promote(projectPath, {
      from: body.from,
      to: body.to,
      ffOnly: body.ffOnly,
      push: body.push,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    // Surface structured codes so the UI can show a "Force merge?" prompt
    res.status(409).json({
      error: err?.message || "Promotion failed",
      code: err?.code,
    });
  }
});

gitRouter.put("/config", async (req, res) => {
  const projectPath = requireProject(req, res);
  if (!projectPath) return;
  try {
    const body = req.body as Partial<TveBranchConfig>;
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "config body is required" });
      return;
    }
    // Read-modify-write so partial updates merge cleanly
    const current = await readConfig(projectPath);
    const next: TveBranchConfig = {
      branches: { ...current.branches, ...(body.branches || {}) },
      git: { ...current.git, ...(body.git || {}) },
      publishing: { ...current.publishing, ...(body.publishing || {}) },
      roles: {
        admins: sanitizeRoleList(body.roles?.admins, current.roles.admins),
        publishers: sanitizeRoleList(body.roles?.publishers, current.roles.publishers),
        reviewers: sanitizeRoleList(body.roles?.reviewers, current.roles.reviewers),
      },
    };
    await writeConfig(projectPath, next);
    res.json({ success: true, config: next });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to write config" });
  }
});
