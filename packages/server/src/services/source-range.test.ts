import { describe, it, expect } from "vitest";
import { innerContentRange } from "./source-range.js";

/** Build a minimal RangeNode from a tag name and its position in source. */
function nodeAt(tagName: string, start: number, end: number) {
  return {
    tagName,
    position: { start: { offset: start }, end: { offset: end } },
  };
}

/** Locate a tag's element bounds in source by a simple scan, so the tests
 *  don't depend on the Astro compiler's exact offsets — innerContentRange
 *  relocates the real bounds via validateElementRange anyway. */
function bounds(source: string, tag: string, occurrence = 0) {
  const open = nthIndexOf(source, `<${tag}`, occurrence);
  const close = source.indexOf(`</${tag}>`, open);
  const end = close + `</${tag}>`.length;
  return { open, end };
}

function nthIndexOf(s: string, needle: string, n: number) {
  let idx = -1;
  for (let i = 0; i <= n; i++) {
    idx = s.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

describe("innerContentRange", () => {
  it("computes inner range for a plain <style>", () => {
    const src = `<style>\n  .a { color: red; }\n</style>`;
    const { open, end } = bounds(src, "style");
    const range = innerContentRange(src, nodeAt("style", open, end));
    expect(range).not.toBeNull();
    expect(src.slice(range!.start, range!.end)).toBe("\n  .a { color: red; }\n");
  });

  it("computes inner range for a plain <script>", () => {
    const src = `<script>\nconsole.log(1);\n</script>`;
    const { open, end } = bounds(src, "script");
    const range = innerContentRange(src, nodeAt("script", open, end));
    expect(src.slice(range!.start, range!.end)).toBe("\nconsole.log(1);\n");
  });

  it("excludes is:global directive from the inner range", () => {
    const src = `<style is:global>\n  .x {}\n</style>`;
    const { open, end } = bounds(src, "style");
    const range = innerContentRange(src, nodeAt("style", open, end));
    const inner = src.slice(range!.start, range!.end);
    expect(inner).toBe("\n  .x {}\n");
    expect(inner).not.toContain("is:global");
  });

  it("excludes define:vars directive from the inner range", () => {
    const src = `<style define:vars={{ accent }}>\n  .c { color: var(--accent); }\n</style>`;
    const { open, end } = bounds(src, "style");
    const range = innerContentRange(src, nodeAt("style", open, end));
    const inner = src.slice(range!.start, range!.end);
    // The inner body is exactly the CSS — the define:vars directive lives in
    // the opening tag, outside this range.
    expect(inner).toBe("\n  .c { color: var(--accent); }\n");
    expect(inner.includes("define:vars")).toBe(false);
    // The `>` of the opening tag (which follows the `}}`) must be just before
    // the inner range start.
    expect(src[range!.start - 1]).toBe(">");
  });

  it("returns an empty range for an empty block", () => {
    const src = `<style></style>`;
    const { open, end } = bounds(src, "style");
    const range = innerContentRange(src, nodeAt("style", open, end));
    expect(range).not.toBeNull();
    expect(range!.start).toBe(range!.end);
  });

  it("returns null for a self-closing element", () => {
    const src = `<script src="/x.js" />`;
    const open = src.indexOf("<script");
    // end just past the `/>`
    const range = innerContentRange(src, nodeAt("script", open, src.length));
    expect(range).toBeNull();
  });
});
