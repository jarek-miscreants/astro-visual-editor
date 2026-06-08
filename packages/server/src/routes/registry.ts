import { Router } from "express";
import { listComponentRegistry, getComponentRegistryEntry } from "../services/component-registry.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";

export const registryRouter = Router();

function validateComponentPath(projectPath: string, relPath: string): string {
  if (!relPath.toLowerCase().endsWith(".astro")) {
    throw new Error("path must reference a .astro file");
  }
  return resolveProjectPath(projectPath, relPath);
}

registryRouter.get("/components", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string | null;
    if (!projectPath) {
      res.status(400).json({ error: "No project is open" });
      return;
    }

    const components = await listComponentRegistry(projectPath);
    res.json({ components });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed to list component registry" });
  }
});

registryRouter.get("/component", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string | null;
    if (!projectPath) {
      res.status(400).json({ error: "No project is open" });
      return;
    }

    const relPath = (req.query.path as string | undefined)?.replace(/\\/g, "/");
    if (!relPath) {
      res.status(400).json({ error: "path query param is required" });
      return;
    }

    validateComponentPath(projectPath, relPath);
    const component = await getComponentRegistryEntry(projectPath, relPath);
    res.json(component);
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "component not found" });
      return;
    }
    res.status(500).json({ error: err?.message || "failed to read component registry entry" });
  }
});
