import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { getRecentProjects, addRecentProject } from "../services/recent-projects.js";

export const projectRouter = Router();

const ASTRO_CONFIG_CANDIDATES = [
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.mts",
  "astro.config.cjs",
];

async function hasAstroConfig(dir: string): Promise<boolean> {
  for (const name of ASTRO_CONFIG_CANDIDATES) {
    try {
      await fs.access(path.join(dir, name));
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

async function hasNodeModules(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, "node_modules"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

projectRouter.get("/info", (req, res) => {
  const p = req.app.locals.projectPath as string | null;
  res.json({
    path: p,
    name: p ? path.basename(p) : null,
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
    const body = req.body as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      res.status(400).json({ error: "path is required" });
      return;
    }
    const abs = path.resolve(body.path);

    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      res.status(400).json({ error: "Path is not a directory" });
      return;
    }

    if (!(await hasAstroConfig(abs))) {
      res.status(400).json({
        error: "Not an Astro project — no astro.config.{mjs,ts,js} found in this folder",
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

    res.json({
      path: abs,
      name: path.basename(abs),
      hasNodeModules: nmPresent,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to switch project" });
  }
});
