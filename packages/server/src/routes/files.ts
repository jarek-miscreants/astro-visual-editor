import { Router } from "express";
import fs from "fs/promises";
import { scanProject } from "../services/project-scanner.js";
import { parseFrontmatterImports } from "../services/frontmatter-imports.js";
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

/** Frontmatter imports for a single .astro file. The editor's AddElementPanel
 *  uses this to surface package-imported components (Icon from astro-icon,
 *  etc.) that the project-component scanner can't see. Defined BEFORE the
 *  catch-all `/*filePath` route so the literal "imports" segment is matched
 *  first instead of being treated as a file name. */
filesRouter.get("/imports/*filePath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const raw = (req.params as any).filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : String(raw);
    const fullPath = resolveProjectPath(projectPath, filePath);
    const source = await fs.readFile(fullPath, "utf-8");
    res.json({ imports: parseFrontmatterImports(source) });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err.message });
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
