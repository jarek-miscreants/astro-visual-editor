import { Router } from "express";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";
import { addSeoToPage, analyzeSeoPage, updateSeoPage } from "../services/seo-page.js";

export const seoRouter = Router();

function normalizePagePath(raw: unknown): string {
  const relPath = String(raw ?? "").replace(/\\/g, "/");
  if (!relPath) throw new Error("path query param is required");
  if (!relPath.startsWith("src/pages/") || !relPath.endsWith(".astro")) {
    throw new Error("SEO panel supports Astro pages under src/pages/ in v1");
  }
  return relPath;
}

seoRouter.get("/page", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const relPath = normalizePagePath(req.query.path);
    resolveProjectPath(projectPath, relPath);
    res.json(await analyzeSeoPage(projectPath, relPath));
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: err?.message || "failed to read SEO data" });
  }
});

seoRouter.post("/page", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const relPath = normalizePagePath(req.query.path);
    resolveProjectPath(projectPath, relPath);
    res.json(await updateSeoPage(projectPath, relPath, req.body ?? {}));
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: err?.message || "failed to update SEO data" });
  }
});

seoRouter.post("/page/add", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const relPath = normalizePagePath(req.query.path);
    resolveProjectPath(projectPath, relPath);
    res.json(await addSeoToPage(projectPath, relPath, req.body ?? {}));
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: err?.message || "failed to add SEO component" });
  }
});
