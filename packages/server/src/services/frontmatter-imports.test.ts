import { describe, it, expect } from "vitest";
import { parseFrontmatterImports } from "./frontmatter-imports.js";

describe("parseFrontmatterImports", () => {
  it("parses default + named imports with project + external sources", () => {
    const source = `---
import Layout from "../layouts/Layout.astro";
import { Icon } from "astro-icon/components";
import Card, { CardHeader as Header } from "../components/Card.astro";
const x = 1;
---
<div></div>
`;
    const imports = parseFrontmatterImports(source);
    expect(imports).toEqual([
      { name: "Layout", source: "../layouts/Layout.astro", isDefault: true, isExternal: false },
      { name: "Icon", source: "astro-icon/components", isDefault: false, isExternal: true },
      { name: "Card", source: "../components/Card.astro", isDefault: true, isExternal: false },
      { name: "Header", source: "../components/Card.astro", isDefault: false, isExternal: false },
    ]);
  });

  it("returns [] when there is no frontmatter", () => {
    expect(parseFrontmatterImports("<div></div>")).toEqual([]);
  });

  it("treats common aliases (~/ and @/) as local", () => {
    const source = `---
import Foo from "~/components/Foo.astro";
import Bar from "@/components/Bar.astro";
---
`;
    const imports = parseFrontmatterImports(source);
    expect(imports.every((i) => !i.isExternal)).toBe(true);
  });

  it("skips line and block comments inside the frontmatter", () => {
    const source = `---
// import Hidden from "should-not-appear";
/* import AlsoHidden from "should-also-not"; */
import Real from "../Real.astro";
---
`;
    const imports = parseFrontmatterImports(source);
    expect(imports.map((i) => i.name)).toEqual(["Real"]);
  });

  it("captures all named bindings from a list", () => {
    const source = `---
import { getCollection, render, getEntry } from "astro:content";
---
`;
    const imports = parseFrontmatterImports(source);
    expect(imports.map((i) => i.name).sort()).toEqual(["getCollection", "getEntry", "render"]);
    // astro: virtual modules don't start with ./ or alias — they're external
    expect(imports.every((i) => i.isExternal)).toBe(true);
  });

  it("ignores `import type` (type-only bindings have no runtime tag)", () => {
    const source = `---
import type { Props } from "../types.ts";
import Real from "../Real.astro";
---
`;
    const imports = parseFrontmatterImports(source);
    expect(imports.map((i) => i.name)).toEqual(["Real"]);
  });
});
