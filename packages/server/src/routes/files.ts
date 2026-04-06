import { Router } from "express";
import fs from "fs/promises";
import { scanProject } from "../services/project-scanner.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";

export const filesRouter = Router();

filesRouter.get("/", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const files = await scanProject(projectPath);
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

filesRouter.get("/*filePath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const raw = (req.params as any).filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : String(raw);
    const fullPath = resolveProjectPath(projectPath, filePath);

    const content = await fs.readFile(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err.message });
  }
});
