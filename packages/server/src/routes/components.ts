import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { parseAstroFileAsync, buildNodeMap } from "../services/astro-parser.js";

export const componentsRouter = Router();

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

    // Get component name from path
    const componentName = path.basename(componentPath, ".astro");
    const pagesDir = path.join(projectPath, "src", "pages");
    const previewPagePath = path.join(pagesDir, PREVIEW_PAGE);

    // Calculate relative import from pages dir to component
    const componentFullPath = path.join(projectPath, componentPath);
    let importPath = path.relative(pagesDir, componentFullPath).replace(/\\/g, "/");
    if (!importPath.startsWith(".")) importPath = "./" + importPath;

    // Generate preview page
    const previewContent = `---
import ${componentName} from '${importPath}';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview: ${componentName}</title>
  </head>
  <body class="p-8 bg-gray-50">
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

    const componentDir = path.join(projectPath, "src", "components");
    const componentPath = path.join(componentDir, `${name}.astro`);

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

    const sourceFullPath = path.join(projectPath, sourceFile);
    const componentDir = path.join(projectPath, "src", "components");
    const componentPath = path.join(componentDir, `${componentName}.astro`);

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

    // Extract the element's HTML from source
    const elementHtml = source.slice(
      node.position.start.offset,
      node.position.end.offset
    );

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
      newSource.slice(0, node.position.start.offset) +
      componentTag +
      newSource.slice(node.position.end.offset);

    // Add import to frontmatter
    const frontmatterEnd = newSource.indexOf("---", 3);
    if (frontmatterEnd !== -1) {
      const importStatement = `import ${componentName} from '${importPath}';\n`;
      newSource =
        newSource.slice(0, frontmatterEnd) +
        importStatement +
        newSource.slice(frontmatterEnd);
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
