import express, { Router } from "express";
import fs from "fs/promises";
import path from "path";
import {
  scanAssets,
  mimeForExt,
  IMAGE_EXTENSIONS,
} from "../services/asset-scanner.js";
import { saveUploadedPublicAsset } from "../services/asset-upload.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";
import { requireEditorOrigin } from "../lib/require-editor-origin.js";

export const assetsRouter = Router();

/** GET /api/assets - list image assets in the project's public/ and src/ trees. */
assetsRouter.get("/", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string | null;
    if (!projectPath) {
      res.json({ assets: [] });
      return;
    }
    const assets = await scanAssets(projectPath);
    res.json({ assets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/assets/upload?filename=hero.webp - write a new public image to
 *  public/images/. Accepts raw binary bytes, not JSON/base64. */
assetsRouter.post(
  "/upload",
  requireEditorOrigin,
  express.raw({ type: "*/*", limit: "25mb" }),
  async (req, res) => {
    try {
      const projectPath = req.app.locals.projectPath as string | null;
      if (!projectPath) {
        res.status(404).json({ error: "no project open" });
        return;
      }

      const filename = String(req.query.filename ?? "");
      if (!filename) {
        res.status(400).json({ error: "filename query param is required" });
        return;
      }
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "request body must be raw image bytes" });
        return;
      }

      const asset = await saveUploadedPublicAsset(projectPath, filename, req.body);
      res.json({ success: true, asset });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/** GET /api/assets/raw/*relPath - serve a raw image file for thumbnails.
 *  Used for both public/ and src/ assets (src/ assets are not otherwise
 *  URL-addressable through the dev server). Restricted to image extensions
 *  and guarded against path traversal. */
assetsRouter.get("/raw/*relPath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string | null;
    if (!projectPath) {
      res.status(404).json({ error: "no project open" });
      return;
    }
    const raw = (req.params as any).relPath;
    const relPath = Array.isArray(raw) ? raw.join("/") : String(raw);

    const ext = path.extname(relPath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      res.status(415).json({ error: "not an image" });
      return;
    }

    const fullPath = resolveProjectPath(projectPath, relPath);
    const data = await fs.readFile(fullPath);
    res.setHeader("Content-Type", mimeForExt(ext));
    // Short cache: assets can change on disk during editing.
    res.setHeader("Cache-Control", "no-cache");
    res.end(data);
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err.message });
  }
});
