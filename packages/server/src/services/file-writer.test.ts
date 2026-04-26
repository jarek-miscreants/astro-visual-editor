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
