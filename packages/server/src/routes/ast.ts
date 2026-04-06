import { Router } from "express";
import { parseAstroFileAsync } from "../services/astro-parser.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";

export const astRouter = Router();

astRouter.get("/*filePath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const raw = (req.params as any).filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : String(raw);
    const fullPath = resolveProjectPath(projectPath, filePath);

    const { ast } = await parseAstroFileAsync(fullPath);
    res.json({ path: filePath, ast });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});
