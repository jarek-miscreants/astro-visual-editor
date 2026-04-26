import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { parseAstroFileAsync, buildNodeMap } from "./astro-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, "__fixtures__", name);

describe("parseAstroFileAsync", () => {
  it("parses simple HTML elements", async () => {
    const { ast, source } = await parseAstroFileAsync(fixture("simple.astro"));
    expect(source).toContain("Hello world");
    expect(ast).toHaveLength(2);
    expect(ast[0].tagName).toBe("h1");
    expect(ast[0].classes).toBe("text-2xl font-bold");
    expect(ast[0].textContent).toBe("Hello world");
    expect(ast[0].isComponent).toBe(false);

    expect(ast[1].tagName).toBe("p");
    expect(ast[1].classes).toBe("mt-4");
  });

  it("assigns stable nodeIds with file-hash + index", async () => {
    const { ast } = await parseAstroFileAsync(fixture("simple.astro"));
    expect(ast[0].nodeId).toMatch(/^tve-[a-f0-9]{8}-\d+$/);
    expect(ast[0].nodeId).not.toBe(ast[1].nodeId);
  });

  it("identifies components by PascalCase tag name", async () => {
    const { ast } = await parseAstroFileAsync(fixture("with-component.astro"));
    // Top level: <section>
    expect(ast).toHaveLength(1);
    const section = ast[0];
    expect(section.tagName).toBe("section");
    expect(section.isComponent).toBe(false);

    // Section contains h2 and Button (component)
    const button = section.children.find((c) => c.tagName === "Button");
    expect(button).toBeDefined();
    expect(button!.isComponent).toBe(true);
  });

  it("captures component attributes as a string map", async () => {
    const { ast } = await parseAstroFileAsync(fixture("with-component.astro"));
    const button = ast[0].children.find((c) => c.tagName === "Button")!;
    expect(button.attributes.variant).toBe("primary");
    expect(button.attributes.href).toBe("/about");
  });

  it("preserves slot text content for components", async () => {
    const { ast } = await parseAstroFileAsync(fixture("with-component.astro"));
    const button = ast[0].children.find((c) => c.tagName === "Button")!;
    expect(button.textContent).toBe("Learn more");
  });

  it("detects JSX class expression bindings (read-only)", async () => {
    const { ast } = await parseAstroFileAsync(fixture("with-class-expression.astro"));
    const btn = ast.find((n) => n.tagName === "button")!;
    expect(btn.classExpression).toBe("{classes}");
    // When class is bound via expression, we don't extract a string value
    expect(btn.classes).toBe("");
  });

  it("includes source positions", async () => {
    const { ast } = await parseAstroFileAsync(fixture("simple.astro"));
    const h1 = ast[0];
    expect(h1.position.start.offset).toBeGreaterThanOrEqual(0);
    expect(h1.position.end.offset).toBeGreaterThan(h1.position.start.offset);
    expect(h1.position.start.line).toBeGreaterThanOrEqual(1);
  });

  it("walks nested children correctly", async () => {
    const { ast } = await parseAstroFileAsync(fixture("simple.astro"));
    const p = ast[1]; // <p class="mt-4">A paragraph with <span>nested text</span>.</p>
    const span = p.children.find((c) => c.tagName === "span");
    expect(span).toBeDefined();
    expect(span!.textContent).toBe("nested text");
  });
});

describe("buildNodeMap", () => {
  it("includes every node in the tree by nodeId", async () => {
    const { ast } = await parseAstroFileAsync(fixture("with-component.astro"));
    const map = buildNodeMap(ast);
    // section + h2 + Button
    expect(map.size).toBeGreaterThanOrEqual(3);
    expect(map.get(ast[0].nodeId)).toBe(ast[0]);
    const button = ast[0].children.find((c) => c.tagName === "Button")!;
    expect(map.get(button.nodeId)).toBe(button);
  });
});
