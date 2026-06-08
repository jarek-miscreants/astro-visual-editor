import { describe, expect, it } from "vitest";
import type { ASTNode, ComponentRegistryEntry } from "@tve/shared";
import {
  buildRegistryComponentHtml,
  resolveInsertionTarget,
} from "./component-insertion";

describe("buildRegistryComponentHtml", () => {
  it("renders registry defaults as Astro component attributes", () => {
    const html = buildRegistryComponentHtml({
      componentPath: "src/components/Hero.astro",
      tagName: "Hero",
      defaultProps: {
        headline: "Fast & clear",
        columns: 3,
        featured: true,
        gated: false,
        empty: null,
      },
    });

    expect(html).toBe(
      '<Hero headline="Fast &amp; clear" columns={3} featured={true} gated={false} />'
    );
  });

  it("renders default children when supplied", () => {
    const html = buildRegistryComponentHtml({
      componentPath: "src/components/Card.astro",
      tagName: "Card",
      defaultProps: { title: 'A "quoted" title' },
      defaultChildren: "<p>Starter copy</p>",
    } satisfies Pick<ComponentRegistryEntry, "componentPath" | "tagName" | "defaultProps" | "defaultChildren">);

    expect(html).toBe(
      '<Card title="A &quot;quoted&quot; title"><p>Starter copy</p></Card>'
    );
  });
});

describe("resolveInsertionTarget", () => {
  it("appends inside selected block containers", () => {
    const ast = [
      node("main", "main", [node("section", "section", [node("p", "p")])]),
    ];

    expect(resolveInsertionTarget(ast, "section")).toEqual({
      parentNodeId: "section",
      position: 1,
    });
  });

  it("inserts after a selected leaf node", () => {
    const ast = [
      node("main", "main", [
        node("h1", "heading"),
        node("p", "copy"),
      ]),
    ];

    expect(resolveInsertionTarget(ast, "heading")).toEqual({
      parentNodeId: "main",
      position: 1,
    });
  });

  it("prefers the first main element when nothing is selected", () => {
    const ast = [
      node("Layout", "layout", [
        node("main", "main", [node("section", "hero")]),
      ]),
    ];

    expect(resolveInsertionTarget(ast, null)).toEqual({
      parentNodeId: "main",
      position: 1,
    });
  });
});

function node(tagName: string, nodeId: string, children: ASTNode[] = []): ASTNode {
  return {
    nodeId,
    tagName,
    isComponent: /^[A-Z]/.test(tagName),
    classes: "",
    textContent: null,
    attributes: {},
    children,
    position: {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
    },
    isDynamic: false,
  };
}
