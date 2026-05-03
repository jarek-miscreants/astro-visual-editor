import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { parseAstroFileAsync, buildNodeMap } from "../services/astro-parser.js";
import { getComponentPropSchema } from "../services/component-props.js";
import { getComponentSlots } from "../services/component-slots.js";
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

const PREVIEW_PAGE = "tve-preview.astro";

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

    // Try to find a Layout component to wrap the preview in (so global styles load)
    const layoutCandidates = [
      "src/layouts/Layout.astro",
      "src/layouts/BaseLayout.astro",
      "src/layouts/MainLayout.astro",
      "src/layouts/Default.astro",
      "src/layouts/index.astro",
    ];
    let layoutImport: string | null = null;
    let layoutName: string | null = null;
    let layoutHasTitle = false;

    for (const candidate of layoutCandidates) {
      const candidatePath = path.join(projectPath, candidate);
      try {
        const content = await fs.readFile(candidatePath, "utf-8");
        const candidateName = path.basename(candidate, ".astro");
        const relativeImport = path
          .relative(pagesDir, candidatePath)
          .replace(/\\/g, "/");
        layoutImport = relativeImport.startsWith(".")
          ? relativeImport
          : "./" + relativeImport;
        layoutName = candidateName;
        // Check if layout accepts a title prop
        layoutHasTitle = /\btitle\??\s*:/i.test(content) || /\btitle\b/i.test(content);
        break;
      } catch {
        continue;
      }
    }

    // Try to find a global stylesheet to import (for projects without a Layout)
    let globalCssImport: string | null = null;
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
        const relativeImport = path
          .relative(pagesDir, candidatePath)
          .replace(/\\/g, "/");
        globalCssImport = relativeImport.startsWith(".")
          ? relativeImport
          : "./" + relativeImport;
        break;
      } catch {
        continue;
      }
    }

    // Generate preview page
    let previewContent: string;
    if (layoutImport && layoutName) {
      // Wrap in project layout (so global styles, fonts, head tags all work)
      const titleProp = layoutHasTitle ? ` title="Preview: ${componentName}"` : "";
      previewContent = `---
import ${layoutName} from '${layoutImport}';
import ${componentName} from '${importPath}';
---

<${layoutName}${titleProp}>
  <${componentName} />
</${layoutName}>
`;
    } else {
      // Standalone with optional global CSS import
      const cssImport = globalCssImport ? `import '${globalCssImport}';\n` : "";
      previewContent = `---
${cssImport}import ${componentName} from '${importPath}';
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
    }

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
