import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { parseAstroFileAsync, buildNodeMap } from "../services/astro-parser.js";
import { getComponentPropSchema } from "../services/component-props.js";
import { getComponentSlots } from "../services/component-slots.js";
import {
  readComponentArrays,
  writeComponentArrayField,
  addComponentArrayItem,
  removeComponentArrayItem,
  moveComponentArrayItem,
} from "../services/component-data.js";
import { validateElementRange } from "../services/source-range.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";

export const componentsRouter = Router();

/** Reject anything that doesn't end in .astro before letting it through the
 *  guard. Components endpoints only ever touch .astro files. */
function validateAstroPath(projectPath: string, relPath: string): string {
  if (!relPath.toLowerCase().endsWith(".astro")) {
    throw new Error("path must reference a .astro file");
  }
  return resolveProjectPath(projectPath, relPath);
}

/** GET /api/components/slots?path=<relPath> — Return the `<slot>` declarations
 *  found in a component's source. Drives the tree's per-slot drop targets so
 *  inserted children get the right `slot="..."` attribute and named-slot
 *  components don't silently swallow content. */
componentsRouter.get("/slots", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const relPath = (req.query.path as string | undefined)?.replace(/\\/g, "/");
    if (!relPath) {
      res.status(400).json({ error: "path query param is required" });
      return;
    }
    validateAstroPath(projectPath, relPath);
    const result = await getComponentSlots(projectPath, relPath);
    res.json(result);
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "component not found" });
      return;
    }
    res.status(500).json({ error: err?.message || "failed to parse slots" });
  }
});

/** GET /api/components/props?path=<relPath> — Return typed Props schema for a component */
componentsRouter.get("/props", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const relPath = (req.query.path as string | undefined)?.replace(/\\/g, "/");
    if (!relPath) {
      res.status(400).json({ error: "path query param is required" });
      return;
    }
    validateAstroPath(projectPath, relPath);
    const schema = await getComponentPropSchema(projectPath, relPath);
    res.json(schema);
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "component not found" });
      return;
    }
    res.status(500).json({ error: err?.message || "failed to parse props" });
  }
});

/** GET /api/components/data?path=<relPath> — Return editable list content
 *  (top-level `const X = [{…}]` arrays) and `.map()` loop bindings for the
 *  repeater panel. */
componentsRouter.get("/data", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const relPath = (req.query.path as string | undefined)?.replace(/\\/g, "/");
    if (!relPath) {
      res.status(400).json({ error: "path query param is required" });
      return;
    }
    validateAstroPath(projectPath, relPath);
    const result = await readComponentArrays(projectPath, relPath);
    res.json(result);
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "component not found" });
      return;
    }
    res.status(500).json({ error: err?.message || "failed to read component data" });
  }
});

/** POST /api/components/data — Rewrite one literal field of a frontmatter
 *  array item (`arrayName[index].field = value`). */
componentsRouter.post("/data", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { path: relPath, arrayName, index, field, value } = req.body as {
      path?: string;
      arrayName?: string;
      index?: number;
      field?: string;
      value?: string | number | boolean;
    };
    const normalized = relPath?.replace(/\\/g, "/");
    if (!normalized || !arrayName || typeof index !== "number" || !field) {
      res.status(400).json({ error: "path, arrayName, index and field are required" });
      return;
    }
    validateAstroPath(projectPath, normalized);
    const result = await writeComponentArrayField(projectPath, normalized, {
      arrayName,
      index,
      field,
      value: value ?? "",
    });
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "component not found" });
      return;
    }
    res.status(500).json({ error: err?.message || "failed to write component data" });
  }
});

/** POST /api/components/array-item — Add, remove, or reorder an item in a
 *  frontmatter array. `op: "add"` appends an empty item matching the array's
 *  shape; `op: "remove"` deletes the item at `index`; `op: "move"` swaps the
 *  item at `index` with its neighbour in direction `dir`. */
componentsRouter.post("/array-item", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { path: relPath, arrayName, op, index, dir } = req.body as {
      path?: string;
      arrayName?: string;
      op?: "add" | "remove" | "move";
      index?: number;
      dir?: "up" | "down";
    };
    const normalized = relPath?.replace(/\\/g, "/");
    if (
      !normalized ||
      !arrayName ||
      (op !== "add" && op !== "remove" && op !== "move")
    ) {
      res
        .status(400)
        .json({ error: "path, arrayName and op (add|remove|move) are required" });
      return;
    }
    validateAstroPath(projectPath, normalized);

    let result;
    if (op === "add") {
      result = await addComponentArrayItem(projectPath, normalized, arrayName);
    } else if (op === "remove") {
      result = await removeComponentArrayItem(
        projectPath,
        normalized,
        arrayName,
        typeof index === "number" ? index : -1
      );
    } else {
      if (dir !== "up" && dir !== "down") {
        res.status(400).json({ error: "move requires dir (up|down)" });
        return;
      }
      result = await moveComponentArrayItem(
        projectPath,
        normalized,
        arrayName,
        typeof index === "number" ? index : -1,
        dir
      );
    }
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "component not found" });
      return;
    }
    res.status(500).json({ error: err?.message || "failed to update array" });
  }
});

const PREVIEW_PAGE = "tve-preview.astro";

/** Side-effect imports (`import "x";` with no binding) from an .astro
 *  file's frontmatter — these are global styles, fonts, polyfills. */
function extractSideEffectImports(astroSource: string): string[] {
  const fm = astroSource.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = fm ? fm[1] : "";
  const specs: string[] = [];
  const re = /^\s*import\s+["']([^"']+)["']\s*;?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(frontmatter)) !== null) specs.push(m[1]);
  return specs;
}

/** Keep CSS / font-package side-effect imports; drop script ones so the
 *  isolated preview doesn't re-run a layout's analytics/JS side effects. */
function isStyleOrFontImport(spec: string): boolean {
  return !/\.(c|m)?[jt]s$/.test(spec);
}

/** Rewrite a relative import specifier from `fromDir` to be relative to
 *  `toDir`. Bare package specifiers are returned unchanged. */
function rewriteImport(spec: string, fromDir: string, toDir: string): string {
  if (!spec.startsWith(".")) return spec;
  const abs = path.resolve(fromDir, spec);
  let rel = path.relative(toDir, abs).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

/** POST /api/components/preview — Generate a preview page for a component */
componentsRouter.post("/preview", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { componentPath } = req.body as { componentPath: string };

    if (!componentPath) {
      res.status(400).json({ error: "componentPath is required" });
      return;
    }

    const componentFullPath = validateAstroPath(projectPath, componentPath);
    const componentName = path.basename(componentPath, ".astro");
    const pagesDir = path.join(projectPath, "src", "pages");
    const previewPagePath = path.join(pagesDir, PREVIEW_PAGE);

    // Calculate relative import from pages dir to component
    let importPath = path.relative(pagesDir, componentFullPath).replace(/\\/g, "/");
    if (!importPath.startsWith(".")) importPath = "./" + importPath;

    // Pull the project layout's GLOBAL STYLES + FONTS into the preview,
    // but render the component in ISOLATION. Wrapping the component in the
    // layout itself would also render the layout's page chrome (Nav,
    // header, skip links, analytics) — not what you want when editing a
    // single component. So we replicate only the layout's side-effect
    // imports (CSS / font packages), not its body.
    const layoutCandidates = [
      "src/layouts/Layout.astro",
      "src/layouts/BaseLayout.astro",
      "src/layouts/MainLayout.astro",
      "src/layouts/Default.astro",
      "src/layouts/index.astro",
    ];

    const styleImports: string[] = [];
    const seenStyles = new Set<string>();
    const addStyle = (spec: string) => {
      if (!seenStyles.has(spec)) {
        seenStyles.add(spec);
        styleImports.push(spec);
      }
    };

    for (const candidate of layoutCandidates) {
      const candidatePath = path.join(projectPath, candidate);
      let content: string;
      try {
        content = await fs.readFile(candidatePath, "utf-8");
      } catch {
        continue;
      }
      const layoutDir = path.dirname(candidatePath);
      for (const spec of extractSideEffectImports(content)) {
        if (isStyleOrFontImport(spec)) {
          addStyle(rewriteImport(spec, layoutDir, pagesDir));
        }
      }
      break; // first matching layout wins
    }

    // Fallback / supplement: a detected global stylesheet, for projects
    // whose layout doesn't import its CSS directly (or that have no layout).
    const cssCandidates = [
      "src/styles/global.css",
      "src/styles/main.css",
      "src/styles/app.css",
      "src/global.css",
      "src/app.css",
    ];
    for (const candidate of cssCandidates) {
      const candidatePath = path.join(projectPath, candidate);
      try {
        await fs.access(candidatePath);
        let rel = path.relative(pagesDir, candidatePath).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = "./" + rel;
        addStyle(rel);
        break;
      } catch {
        continue;
      }
    }

    // Render the component standalone in a minimal shell, with the
    // project's global styles + fonts but none of the layout chrome.
    const styleImportLines = styleImports
      .map((s) => `import '${s}';`)
      .join("\n");
    const previewContent = `---
${styleImportLines}${styleImportLines ? "\n" : ""}import ${componentName} from '${importPath}';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview: ${componentName}</title>
  </head>
  <body>
    <${componentName} />
  </body>
</html>
`;

    await fs.mkdir(pagesDir, { recursive: true });
    await fs.writeFile(previewPagePath, previewContent, "utf-8");

    res.json({
      success: true,
      previewRoute: "/tve-preview",
    });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid componentPath" });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/components/create — Create a new .astro component */
componentsRouter.post("/create", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { name, template } = req.body as {
      name: string;
      template?: string;
    };

    if (!name || !/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      res.status(400).json({
        error: "Component name must be PascalCase (e.g., Card, HeroSection)",
      });
      return;
    }

    const componentDir = resolveProjectPath(projectPath, "src/components");
    const componentPath = resolveProjectPath(projectPath, `src/components/${name}.astro`);

    // Check if already exists
    try {
      await fs.access(componentPath);
      res.status(409).json({ error: `Component ${name}.astro already exists` });
      return;
    } catch {
      // Good — doesn't exist
    }

    // Ensure components directory exists
    await fs.mkdir(componentDir, { recursive: true });

    // Generate component content
    const content = template || generateComponentTemplate(name);
    await fs.writeFile(componentPath, content, "utf-8");

    const relativePath = `src/components/${name}.astro`;
    res.json({
      success: true,
      path: relativePath,
      name,
    });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/components/extract — Extract an element into a new component */
componentsRouter.post("/extract", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { sourceFile, nodeId, componentName } = req.body as {
      sourceFile: string;
      nodeId: string;
      componentName: string;
    };

    if (!componentName || !/^[A-Z][a-zA-Z0-9]*$/.test(componentName)) {
      res.status(400).json({ error: "Component name must be PascalCase" });
      return;
    }

    const sourceFullPath = validateAstroPath(projectPath, sourceFile);
    const componentDir = resolveProjectPath(projectPath, "src/components");
    const componentPath = resolveProjectPath(projectPath, `src/components/${componentName}.astro`);

    // Check if component already exists
    try {
      await fs.access(componentPath);
      res.status(409).json({ error: `Component ${componentName}.astro already exists` });
      return;
    } catch {
      // Good
    }

    // Parse source file to find the element
    const source = await fs.readFile(sourceFullPath, "utf-8");
    const { ast } = await parseAstroFileAsync(sourceFullPath);
    const nodeMap = buildNodeMap(ast);
    const node = nodeMap.get(nodeId);

    if (!node) {
      res.status(404).json({ error: `Node ${nodeId} not found in ${sourceFile}` });
      return;
    }

    const validatedRange = validateElementRange(source, node);
    if (!validatedRange) {
      res.status(400).json({ error: `Could not validate range for ${node.tagName}` });
      return;
    }

    // Extract the element's HTML from source
    const elementHtml = source.slice(validatedRange.start, validatedRange.end);

    // Create the component file
    await fs.mkdir(componentDir, { recursive: true });

    const componentContent = `---
interface Props {
  class?: string;
}
const { class: className } = Astro.props;
---

${elementHtml}
`;
    await fs.writeFile(componentPath, componentContent, "utf-8");

    // Calculate relative import path from source file to component
    const sourceDir = path.dirname(sourceFullPath);
    let importPath = path.relative(sourceDir, componentPath).replace(/\\/g, "/");
    if (!importPath.startsWith(".")) importPath = "./" + importPath;

    // Now modify the source file:
    // 1. Add import to frontmatter
    // 2. Replace the element with <ComponentName />
    let newSource = source;

    // Replace element with component tag
    const componentTag = `<${componentName} />`;
    newSource =
      newSource.slice(0, validatedRange.start) +
      componentTag +
      newSource.slice(validatedRange.end);

    // Add import to frontmatter
    const importStatement = `import ${componentName} from '${importPath}';`;
    const frontmatterStart = newSource.indexOf("---");
    const hasFrontmatter =
      frontmatterStart !== -1 &&
      (frontmatterStart === 0 || newSource.slice(0, frontmatterStart).trim() === "");
    const frontmatterEnd = hasFrontmatter
      ? newSource.indexOf("---", frontmatterStart + 3)
      : -1;
    if (frontmatterEnd !== -1) {
      newSource =
        newSource.slice(0, frontmatterEnd) +
        importStatement +
        "\n" +
        newSource.slice(frontmatterEnd);
    } else {
      newSource = `---\n${importStatement}\n---\n\n${newSource}`;
    }

    await fs.writeFile(sourceFullPath, newSource, "utf-8");

    // Re-parse to get updated AST
    const { ast: newAst } = await parseAstroFileAsync(sourceFullPath);

    res.json({
      success: true,
      componentPath: `src/components/${componentName}.astro`,
      sourceAst: newAst,
    });
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(400).json({ error: "invalid sourceFile" });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

function generateComponentTemplate(name: string): string {
  return `---
interface Props {
  class?: string;
}
const { class: className } = Astro.props;
---

<div class={className}>
  <p>New ${name} component</p>
</div>
`;
}
