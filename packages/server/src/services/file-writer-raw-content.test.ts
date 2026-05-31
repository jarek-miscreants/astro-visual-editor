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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-fw-raw-"));
});

async function stage(fixtureName: string): Promise<string> {
  const src = path.join(fixturesDir, fixtureName);
  const dst = path.join(tmpDir, fixtureName);
  await fs.copyFile(src, dst);
  return dst;
}

async function readFile(p: string): Promise<string> {
  return fs.readFile(p, "utf-8");
}

/** Find the AST node for the nth element with the given tag name. */
function findNth(ast: any[], tag: string, n = 0): any {
  let count = 0;
  let found: any = null;
  function walk(nodes: any[]) {
    for (const node of nodes) {
      if (node.tagName === tag) {
        if (count === n) found = node;
        count++;
      }
      if (found) return;
      walk(node.children);
    }
  }
  walk(ast);
  return found;
}

describe("applyMutation: update-raw-content", () => {
  it("replaces only the inner range of a <style is:global> block", async () => {
    const file = await stage("raw-content-input.astro");
    const before = await readFile(file);
    const { ast } = await parseAstroFileAsync(file);
    const style = findNth(ast, "style", 0); // <style is:global>

    const result = await applyMutation(file, {
      type: "update-raw-content",
      nodeId: style.nodeId,
      content: "\n    .a { color: green; }\n  ",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);

    // New content present, old gone.
    expect(out).toContain(".a { color: green; }");
    expect(out).not.toContain(".a { color: red; }");
    // Opening tag + directive preserved byte-for-byte.
    expect(out).toContain("<style is:global>");
    expect(out).toContain("</style>");
    // Other blocks untouched.
    expect(out).toContain('.c { color: var(--accent); }');
    expect(out).toContain('console.log("first");');
    // Frontmatter + sibling markup untouched.
    expect(out).toContain('const accent = "#f00";');
    expect(out).toContain("<p>Body</p>");
    // Everything outside the edited block is byte-identical: reconstruct.
    const styleOpen = before.indexOf("<style is:global>") + "<style is:global>".length;
    const styleClose = before.indexOf("</style>", styleOpen);
    const expected =
      before.slice(0, styleOpen) +
      "\n    .a { color: green; }\n  " +
      before.slice(styleClose);
    expect(out).toBe(expected);
  });

  it("preserves define:vars directive when editing that block", async () => {
    const file = await stage("raw-content-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const style = findNth(ast, "style", 1); // <style define:vars={{ accent }}>

    const result = await applyMutation(file, {
      type: "update-raw-content",
      nodeId: style.nodeId,
      content: "\n    .c { color: hotpink; }\n  ",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain("<style define:vars={{ accent }}>");
    expect(out).toContain(".c { color: hotpink; }");
    expect(out).not.toContain("var(--accent)");
  });

  it("preserves script directives (is:inline, lang) when editing", async () => {
    const file = await stage("raw-content-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const script = findNth(ast, "script", 1); // <script is:inline lang="ts">

    const result = await applyMutation(file, {
      type: "update-raw-content",
      nodeId: script.nodeId,
      content: "\n    const m: number = 99;\n  ",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain('<script is:inline lang="ts">');
    expect(out).toContain("const m: number = 99;");
    expect(out).not.toContain("const n: number = 2;");
  });

  it("edits multiple blocks independently", async () => {
    const file = await stage("raw-content-input.astro");

    // Edit first style.
    let ast = (await parseAstroFileAsync(file)).ast;
    await applyMutation(file, {
      type: "update-raw-content",
      nodeId: findNth(ast, "style", 0).nodeId,
      content: "\n    .a { color: green; }\n  ",
    });

    // Re-parse, edit first script.
    ast = (await parseAstroFileAsync(file)).ast;
    await applyMutation(file, {
      type: "update-raw-content",
      nodeId: findNth(ast, "script", 0).nodeId,
      content: '\n    console.log("changed");\n  ',
    });

    const out = await readFile(file);
    expect(out).toContain(".a { color: green; }");
    expect(out).toContain('console.log("changed");');
    // The other two blocks remain exactly as authored.
    expect(out).toContain(".c { color: var(--accent); }");
    expect(out).toContain("const n: number = 2;");
  });

  it("inverse (old inner text) restores the block exactly — round trip", async () => {
    const file = await stage("raw-content-input.astro");
    const before = await readFile(file);
    const { ast } = await parseAstroFileAsync(file);
    const style = findNth(ast, "style", 0);
    const oldInner = style.rawTextContent;
    expect(typeof oldInner).toBe("string");

    // Forward edit.
    await applyMutation(file, {
      type: "update-raw-content",
      nodeId: style.nodeId,
      content: "\n    .a { color: green; }\n  ",
    });

    // Inverse edit using the captured old inner text. The node index is
    // stable here because the edit doesn't add/remove elements.
    const ast2 = (await parseAstroFileAsync(file)).ast;
    const style2 = findNth(ast2, "style", 0);
    await applyMutation(file, {
      type: "update-raw-content",
      nodeId: style2.nodeId,
      content: oldInner,
    });

    const after = await readFile(file);
    expect(after).toBe(before);
  });

  it("parser surfaces untrimmed rawTextContent for style/script", async () => {
    const file = await stage("raw-content-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const style = findNth(ast, "style", 0);
    // Untrimmed: includes the surrounding newlines/indentation.
    expect(style.rawTextContent).toContain("\n    .a { color: red; }");
    expect(style.rawTextContent.startsWith("\n")).toBe(true);
  });

  it("returns success: false for an unknown nodeId (no write)", async () => {
    const file = await stage("raw-content-input.astro");
    const before = await readFile(file);

    const result = await applyMutation(file, {
      type: "update-raw-content",
      nodeId: "tve-deadbeef-99",
      content: ".x {}",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    // Source on disk is untouched.
    expect(await readFile(file)).toBe(before);
  });

  it("returns success: false for a self-closing/void target (no inner range)", async () => {
    // A non-style/script paired node still has an inner range, so the honest
    // "no inner range" failure surfaces on a self-closing element. The fixture
    // markup includes a paired <p> with body text; aim update-raw-content at a
    // self-closing node to exercise the guard that refuses bodyless elements.
    const file = await stage("self-closing-component.astro");
    const before = await readFile(file);
    const { ast } = await parseAstroFileAsync(file);
    const sectionMain = ast[0].children.find((c) => c.tagName === "SectionMain")!;
    expect(sectionMain).toBeDefined();

    const result = await applyMutation(file, {
      type: "update-raw-content",
      nodeId: sectionMain.nodeId,
      content: "anything",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inner content range|self-closing|void/i);
    // Source on disk is untouched.
    expect(await readFile(file)).toBe(before);
  });

  it("overwrites the body of a non-style/script paired element (generic primitive)", async () => {
    // update-raw-content is a generic inner-range edit. On a paired <p> it
    // should replace the body text and leave the tags intact — confirming the
    // mutation isn't hard-limited to style/script and behaves predictably on
    // an ordinary element.
    const file = await stage("raw-content-input.astro");
    const { ast } = await parseAstroFileAsync(file);
    const p = findNth(ast, "p", 0);
    expect(p).toBeDefined();

    const result = await applyMutation(file, {
      type: "update-raw-content",
      nodeId: p.nodeId,
      content: "Changed body",
    });

    expect(result.success).toBe(true);
    const out = await readFile(file);
    expect(out).toContain("<p>Changed body</p>");
    expect(out).not.toContain("<p>Body</p>");
  });
});
