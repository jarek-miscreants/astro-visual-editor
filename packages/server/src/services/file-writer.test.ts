import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { fileURLToPath } from "url";
import { applyMutation } from "./file-writer.js";
import { parseAstroFileAsync } from "./astro-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "__fixtures__");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-fw-"));
});

/**
 * Copy a fixture into a fresh tmp file so the mutation can write back
 * without touching the source fixture. Returns the tmp file path.
 */
async function stage(fixtureName: string): Promise<string> {
  const src = path.join(fixturesDir, fixtureName);
  const dst = path.join(tmpDir, fixtureName);
  await fs.copyFile(src, dst);
  return dst;
}

async function readFile(p: string): Promise<string> {
  return fs.readFile(p, "utf-8");
}

describe("applyMutation: update-classes", () => {
  it("rewrites the class attribute exactly", async () => {
    const file = await stage("update-classes-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const div = ast[0]; // top-level <div class="p-4 mx-auto">

    const result = await applyMutation(file, {
      type: "update-classes",
      nodeId: div.nodeId,
      classes: "p-8 mx-auto bg-blue-600",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain('class="p-8 mx-auto bg-blue-600"');
    // Original should be gone (no leftover p-4)
    expect(out).not.toContain('class="p-4 mx-auto"');
    // Children should be untouched
    expect(out).toContain('<h1 class="text-2xl">Title</h1>');
  });

  it("only modifies the targeted opening tag (regression: opening-tag-only search)", async () => {
    // The h1 has its own class. Mutating the parent div must not touch the h1's class.
    const file = await stage("update-classes-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const div = ast[0];

    await applyMutation(file, {
      type: "update-classes",
      nodeId: div.nodeId,
      classes: "p-2",
    });

    const out = await readFile(file);
    expect(out).toContain('<h1 class="text-2xl">Title</h1>');
  });

  it("refuses to overwrite a JSX expression class binding", async () => {
    const file = path.join(tmpDir, "expr.astro");
    await fs.copyFile(
      path.join(fixturesDir, "with-class-expression.astro"),
      file
    );
    const { ast } = await parseAstroFileAsync(file);
    const btn = ast.find((n) => n.tagName === "button")!;

    const result = await applyMutation(file, {
      type: "update-classes",
      nodeId: btn.nodeId,
      classes: "should-not-write",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/JSX expression binding|class=\{/);
    const out = await readFile(file);
    expect(out).not.toContain("should-not-write");
    expect(out).toContain("class={classes}");
  });

  it("returns success: false for unknown nodeId", async () => {
    const file = await stage("update-classes-input.astro");
    const result = await applyMutation(file, {
      type: "update-classes",
      nodeId: "tve-deadbeef-99",
      classes: "x",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("inserts a new class attribute INSIDE the opening tag for a component (regression: SectionMain start offset)", async () => {
    // Reproduces the bug where adding a first class to a component whose
    // parser-reported start offset was off-by-N produced ` class="flex"`
    // OUTSIDE the opening tag, leaking into the rendered page as text.
    const file = await stage("self-closing-component.astro");
    const { ast } = await parseAstroFileAsync(file);
    const main = ast[0];
    const sectionMain = main.children.find((c) => c.tagName === "SectionMain")!;
    expect(sectionMain).toBeDefined();

    const result = await applyMutation(file, {
      type: "update-classes",
      nodeId: sectionMain.nodeId,
      classes: "flex",
    });
    expect(result.success).toBe(true);

    const out = await readFile(file);
    // The class must live inside the opening tag, not as content between tags.
    expect(out).toMatch(/<SectionMain\s+class="flex"\s*\/>/);
    // No leak of `class="flex"` floating between elements.
    expect(out).not.toMatch(/<\/SectionMain>\s*class="flex"/);
    expect(out).not.toMatch(/>\s*class="flex"\s*</);
  });
});

describe("applyMutation: update-text", () => {
  it("replaces direct text content", async () => {
    const file = await stage("update-text-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const h1 = ast[0];

    const result = await applyMutation(file, {
      type: "update-text",
      nodeId: h1.nodeId,
      text: "Brand new heading",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain("Brand new heading");
    expect(out).not.toContain("Original heading");
  });

  it("preserves surrounding markup", async () => {
    const file = await stage("update-text-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const h1 = ast[0];

    await applyMutation(file, {
      type: "update-text",
      nodeId: h1.nodeId,
      text: "X",
    });

    const out = await readFile(file);
    expect(out).toMatch(/<h1 class="text-2xl">X<\/h1>/);
    expect(out).toContain("<p>Old body text.</p>");
  });
});

describe("applyMutation: update-attribute", () => {
  it("sets a new attribute value", async () => {
    const file = await stage("with-component.astro");
    const { ast } = await parseAstroFileAsync(file);
    const button = ast[0].children.find((c) => c.tagName === "Button")!;

    const result = await applyMutation(file, {
      type: "update-attribute",
      nodeId: button.nodeId,
      attr: "href",
      value: "/contact",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain('href="/contact"');
    expect(out).not.toContain('href="/about"');
  });

  it("removes an attribute when value is null", async () => {
    const file = await stage("with-component.astro");
    const { ast } = await parseAstroFileAsync(file);
    const button = ast[0].children.find((c) => c.tagName === "Button")!;

    const result = await applyMutation(file, {
      type: "update-attribute",
      nodeId: button.nodeId,
      attr: "href",
      value: null,
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).not.toContain("href=");
    // Other attributes preserved
    expect(out).toContain('variant="primary"');
  });

  it("adds a new attribute when not present", async () => {
    const file = await stage("with-component.astro");
    const { ast } = await parseAstroFileAsync(file);
    const button = ast[0].children.find((c) => c.tagName === "Button")!;

    await applyMutation(file, {
      type: "update-attribute",
      nodeId: button.nodeId,
      attr: "target",
      value: "_blank",
    });

    const out = await readFile(file);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('href="/about"'); // didn't disturb existing
  });
});

describe("applyMutation: remove-element", () => {
  it("removes an element and updates AST", async () => {
    const file = await stage("simple.astro");
    const { ast } = await parseAstroFileAsync(file);
    const p = ast[1]; // <p class="mt-4">

    const result = await applyMutation(file, {
      type: "remove-element",
      nodeId: p.nodeId,
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain("Hello world");
    expect(out).not.toContain("A paragraph");
  });
});

describe("applyMutation: duplicate-element", () => {
  it("duplicates the element next to the original", async () => {
    const file = await stage("simple.astro");
    const { ast } = await parseAstroFileAsync(file);
    const h1 = ast[0];

    const result = await applyMutation(file, {
      type: "duplicate-element",
      nodeId: h1.nodeId,
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    // Two h1s now
    const matches = out.match(/<h1 class="text-2xl font-bold">Hello world<\/h1>/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });
});

describe("applyMutation: add-element", () => {
  it("expands a self-closing component to wrap a new child (regression: SectionMain corruption)", async () => {
    // Reproduces the bug where dropping a div into the slot of a self-closing
    // component (<SectionMain />) produced corrupt source like
    //   `<SectionMain <div></div> />`
    // because the parser reported an end offset that fell short of `/>` and
    // the +2 byte search window missed it.
    const file = await stage("self-closing-component.astro");
    const { ast } = await parseAstroFileAsync(file);
    // <main> contains <SectionMain /> and <Card />
    const main = ast[0];
    const sectionMain = main.children.find((c) => c.tagName === "SectionMain")!;
    expect(sectionMain).toBeDefined();

    const result = await applyMutation(file, {
      type: "add-element",
      parentNodeId: sectionMain.nodeId,
      position: 0,
      html: "<div>Inserted</div>",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    // The opening tag must remain syntactically clean — no `<` between the
    // tag name and `>`, no orphaned `/`, no `<SectionMain ` left mid-tag.
    expect(out).not.toMatch(/<SectionMain[^>]*<div/);
    expect(out).not.toMatch(/<SectionMain[^>]*\/\s*>/);
    // And the new structure: <SectionMain>\n  <div>Inserted</div>\n</SectionMain>
    expect(out).toMatch(/<SectionMain>\s*\n\s*<div>Inserted<\/div>\s*\n\s*<\/SectionMain>/);
  });

  it("appends to a non-empty parent before the close tag", async () => {
    const file = await stage("with-component.astro");
    const { ast } = await parseAstroFileAsync(file);
    const section = ast[0]; // <section>
    expect(section.tagName).toBe("section");
    expect(section.children.length).toBeGreaterThan(0);

    const result = await applyMutation(file, {
      type: "add-element",
      parentNodeId: section.nodeId,
      position: 99, // past end → append
      html: "<p>Appended</p>",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    // Appended <p> appears before </section>
    const appendIdx = out.indexOf("<p>Appended</p>");
    const closeIdx = out.indexOf("</section>");
    expect(appendIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(appendIdx);
    // Existing children are untouched
    expect(out).toContain('<h2 class="text-3xl">Title</h2>');
  });
});

describe("applyMutation: wrap-element", () => {
  it("wraps an element in a new tag with optional classes", async () => {
    const file = await stage("simple.astro");
    const { ast } = await parseAstroFileAsync(file);
    const h1 = ast[0];

    const result = await applyMutation(file, {
      type: "wrap-element",
      nodeId: h1.nodeId,
      wrapperTag: "div",
      wrapperClasses: "wrapper",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    // Original h1 must still be present, now nested inside the new wrapper
    expect(out).toContain('<div class="wrapper">');
    expect(out).toContain('<h1 class="text-2xl font-bold">Hello world</h1>');
    // Order: opening wrapper appears before the h1
    expect(out.indexOf('<div class="wrapper">')).toBeLessThan(
      out.indexOf("<h1")
    );
  });
});
