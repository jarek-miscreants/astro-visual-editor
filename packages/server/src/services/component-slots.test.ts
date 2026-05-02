import { describe, it, expect } from "vitest";
import { parseComponentSlots } from "./component-slots.js";

describe("parseComponentSlots", () => {
  it("returns a single default slot for a bare <slot />", () => {
    const src = `---\n---\n<div><slot /></div>`;
    expect(parseComponentSlots(src)).toEqual([{ name: null }]);
  });

  it("returns named slots in source order", () => {
    const src = `---\n---\n<div>
  <slot name="icon" />
  <slot name="content" />
</div>`;
    expect(parseComponentSlots(src)).toEqual([
      { name: "icon" },
      { name: "content" },
    ]);
  });

  it("captures both default and named slots in the same component", () => {
    const src = `<div><slot name="header" /><slot /><slot name="footer" /></div>`;
    expect(parseComponentSlots(src)).toEqual([
      { name: "header" },
      { name: null },
      { name: "footer" },
    ]);
  });

  it("dedupes a slot name that appears twice", () => {
    const src = `<div><slot name="x" /><slot name="x" /></div>`;
    expect(parseComponentSlots(src)).toEqual([{ name: "x" }]);
  });

  it("handles single-quoted name attributes", () => {
    const src = `<slot name='alt' />`;
    expect(parseComponentSlots(src)).toEqual([{ name: "alt" }]);
  });

  it("skips slots whose name is a JSX expression (not statically resolvable)", () => {
    const src = `<slot name={dynamic} /><slot name="literal" />`;
    expect(parseComponentSlots(src)).toEqual([{ name: "literal" }]);
  });

  it("returns [] when the component has no <slot> tags", () => {
    const src = `<div>No slots here</div>`;
    expect(parseComponentSlots(src)).toEqual([]);
  });

  it("matches non-self-closing <slot></slot>", () => {
    const src = `<div><slot name="body">fallback content</slot></div>`;
    expect(parseComponentSlots(src)).toEqual([{ name: "body" }]);
  });
});
