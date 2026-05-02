import { Router } from "express";
import {
  scanContentFiles,
  readContentFile,
  writeContentFile,
  createContentFile,
} from "../services/content-files.js";
import {
  getCollectionRouting,
  resolveEntryUrl,
} from "../services/collection-routing.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";

export const contentRouter = Router();

/** GET /api/content/list — list all .md/.mdx files under conventional content roots */
contentRouter.get("/list", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const files = await scanContentFiles(projectPath);
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/content/read/* — read a markdown file into { frontmatter, body } */
contentRouter.get("/read/*filePath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const raw = (req.params as any).filePath;
    const relPath = Array.isArray(raw) ? raw.join("/") : String(raw);
    resolveProjectPath(projectPath, relPath);
    const file = await readContentFile(projectPath, relPath);
    res.json(file);
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err.message });
  }
});

/** POST /api/content/write/* — write { frontmatter, body } back to disk */
contentRouter.post("/write/*filePath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const raw = (req.params as any).filePath;
    const relPath = Array.isArray(raw) ? raw.join("/") : String(raw);
    resolveProjectPath(projectPath, relPath);

    const { frontmatter, body } = req.body ?? {};
    if (typeof body !== "string") {
      res.status(400).json({ error: "body must be a string" });
      return;
    }
    if (frontmatter !== undefined && (typeof frontmatter !== "object" || frontmatter === null)) {
      res.status(400).json({ error: "frontmatter must be an object" });
      return;
    }

    await writeContentFile(projectPath, relPath, frontmatter ?? {}, body);
    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/content/create — create a new .md/.mdx file in a collection */
contentRouter.post("/create", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { collection, slug, format, root, frontmatter, body } = req.body ?? {};

    if (typeof collection !== "string" || typeof slug !== "string") {
      res.status(400).json({ error: "collection and slug are required strings" });
      return;
    }
    if (format !== "md" && format !== "mdx") {
      res.status(400).json({ error: "format must be 'md' or 'mdx'" });
      return;
    }
    if (root !== undefined && root !== "src/content" && root !== "src/pages" && root !== "content") {
      res.status(400).json({ error: "invalid root" });
      return;
    }
    if (frontmatter !== undefined && (typeof frontmatter !== "object" || frontmatter === null)) {
      res.status(400).json({ error: "frontmatter must be an object" });
      return;
    }
    if (body !== undefined && typeof body !== "string") {
      res.status(400).json({ error: "body must be a string" });
      return;
    }

    const result = await createContentFile(projectPath, {
      collection,
      slug,
      format,
      root,
      frontmatter,
      body,
    });

    // Validate the resolved path is inside the project
    resolveProjectPath(projectPath, result.path);

    res.json({ success: true, path: result.path });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err.code === "EEXIST") {
      res.status(409).json({ error: err.message, code: "EEXIST" });
      return;
    }
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/content/routing — classify every collection as routed / embedded /
 *  orphan. Drives the editor's preview affordance: routed collections get an
 *  iframe preview at the real URL, embedded ones get form-only editing, and
 *  orphans get a banner pointing out the unused content. */
contentRouter.get("/routing", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const map = await getCollectionRouting(projectPath);
    res.json({ collections: Object.fromEntries(map) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/content/preview-url?collection=blog&slug=my-post — resolve a
 *  single entry to a URL using the same routing map. Returns null when the
 *  collection isn't routed; caller is expected to fall back to a synthetic
 *  preview for embedded/orphan collections. */
contentRouter.get("/preview-url", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const collection = String(req.query.collection ?? "");
    const slug = String(req.query.slug ?? "");
    if (!collection || !slug) {
      res.status(400).json({ error: "collection and slug query params are required" });
      return;
    }
    const map = await getCollectionRouting(projectPath);
    const status = map.get(collection);
    if (!status) {
      res.json({ url: null, status: { kind: "orphan", collection } });
      return;
    }
    res.json({ url: resolveEntryUrl(status, slug), status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
