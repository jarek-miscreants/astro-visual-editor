import { Router } from "express";
import fs from "fs/promises";
import path from "path";

export const pagesRouter = Router();

/** POST /api/pages/create — Create a new static .astro page under src/pages.
 *
 *  body: { route: string, template: "blank" | "layout" }
 *
 *  - `route` becomes a path under src/pages: "about" → src/pages/about.astro,
 *    "blog/welcome" → src/pages/blog/welcome.astro.
 *  - "blank" template emits a minimal HTML doc.
 *  - "layout" template scans src/layouts for the first .astro file and wraps
 *    a starter heading in `<Layout title="..." />`. Falls back to blank if
 *    no layout is found.
 *
 *  Validation rejects dynamic-route brackets (`[`/`]`) — those are a
 *  separate flow we haven't built. Path traversal is blocked. Returns 409
 *  if the file already exists. */
pagesRouter.post("/create", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    if (!projectPath) {
      res.status(400).json({ error: "no project open" });
      return;
    }
    const { route, template } = req.body as {
      route?: string;
      template?: "blank" | "layout";
    };
    if (!route || typeof route !== "string") {
      res.status(400).json({ error: "route is required" });
      return;
    }

    // Sanitize: strip leading/trailing slashes, normalize separators
    const cleanRoute = route.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!cleanRoute) {
      res.status(400).json({ error: "route cannot be empty" });
      return;
    }
    if (cleanRoute.includes("..")) {
      res.status(400).json({ error: "invalid route" });
      return;
    }
    if (/[\[\]]/.test(cleanRoute)) {
      res.status(400).json({
        error: "dynamic routes (with [brackets]) aren't supported here yet",
      });
      return;
    }
    // Each segment must be a kebab/lowercase identifier
    const segments = cleanRoute.split("/");
    for (const seg of segments) {
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(seg)) {
        res.status(400).json({
          error: `invalid path segment "${seg}" — use kebab-case (a-z, 0-9, -, _)`,
        });
        return;
      }
    }

    const pagesDir = path.join(projectPath, "src", "pages");
    const filePath = path.join(pagesDir, `${cleanRoute}.astro`);

    // Path-traversal guard: resolved file must stay inside src/pages
    const resolved = path.resolve(filePath);
    const resolvedPagesDir = path.resolve(pagesDir);
    if (
      !resolved.startsWith(resolvedPagesDir + path.sep) &&
      resolved !== resolvedPagesDir
    ) {
      res.status(400).json({ error: "route escapes src/pages" });
      return;
    }

    // Refuse to clobber an existing page
    try {
      await fs.access(filePath);
      res.status(409).json({ error: `page ${cleanRoute}.astro already exists` });
      return;
    } catch {
      // good — doesn't exist
    }

    const titleText = humanizeRoute(cleanRoute);
    let content: string;
    let usedLayout: string | null = null;

    if (template === "layout") {
      const layout = await detectLayout(projectPath, filePath);
      if (layout) {
        usedLayout = layout.name;
        content = renderLayoutTemplate(layout.name, layout.importPath, layout.hasTitleProp, titleText);
      } else {
        // No layout in project — fall back to blank
        content = renderBlankTemplate(titleText);
      }
    } else {
      content = renderBlankTemplate(titleText);
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");

    const relativePath = `src/pages/${cleanRoute}.astro`;
    const url = "/" + cleanRoute.replace(/\/index$/, "/").replace(/^index$/, "");
    res.json({
      success: true,
      path: relativePath,
      route: url,
      layout: usedLayout,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed to create page" });
  }
});

/** Walk src/layouts looking for the first .astro file. Returns the layout
 *  name + its import path *relative to the new page* + whether it accepts
 *  a `title` prop (so the template only emits `title=...` if it'll be used). */
async function detectLayout(
  projectPath: string,
  newPageFullPath: string
): Promise<{ name: string; importPath: string; hasTitleProp: boolean } | null> {
  const candidates = [
    "src/layouts/Layout.astro",
    "src/layouts/BaseLayout.astro",
    "src/layouts/MainLayout.astro",
    "src/layouts/Default.astro",
    "src/layouts/index.astro",
  ];
  for (const candidate of candidates) {
    const candidatePath = path.join(projectPath, candidate);
    try {
      const source = await fs.readFile(candidatePath, "utf-8");
      const name = path.basename(candidate, ".astro");
      const importPath = relativeImport(newPageFullPath, candidatePath);
      const hasTitleProp = /\btitle\s*\??\s*:/.test(source);
      return { name, importPath, hasTitleProp };
    } catch {
      continue;
    }
  }
  // Fallback: scan src/layouts for the first .astro file
  const layoutsDir = path.join(projectPath, "src", "layouts");
  try {
    const entries = await fs.readdir(layoutsDir);
    const first = entries.find((f) => f.endsWith(".astro"));
    if (first) {
      const candidatePath = path.join(layoutsDir, first);
      const source = await fs.readFile(candidatePath, "utf-8");
      const name = path.basename(first, ".astro");
      const importPath = relativeImport(newPageFullPath, candidatePath);
      const hasTitleProp = /\btitle\s*\??\s*:/.test(source);
      return { name, importPath, hasTitleProp };
    }
  } catch {
    // no layouts dir
  }
  return null;
}

function relativeImport(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function humanizeRoute(route: string): string {
  // "blog/welcome-post" → "Welcome post"
  const last = route.split("/").pop() || route;
  const spaced = last.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderBlankTemplate(title: string): string {
  return `---
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <h1>${title}</h1>
  </body>
</html>
`;
}

function renderLayoutTemplate(
  layoutName: string,
  importPath: string,
  hasTitleProp: boolean,
  title: string
): string {
  const titleAttr = hasTitleProp ? ` title="${title}"` : "";
  return `---
import ${layoutName} from "${importPath}";
---

<${layoutName}${titleAttr}>
  <h1>${title}</h1>
</${layoutName}>
`;
}
