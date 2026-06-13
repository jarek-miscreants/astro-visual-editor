import { describe, it, expect } from "vitest";
import {
  generateRepeaterSource,
  validateRepeaterInput,
  isValidIdentifier,
  type GenerateRepeaterInput,
} from "./repeater-generator.js";

const base: GenerateRepeaterInput = {
  arrayName: "features",
  itemVar: "feature",
  layout: "card-grid",
  fields: [
    { name: "title", type: "text" },
    { name: "body", type: "textarea" },
    { name: "image", type: "image" },
    { name: "href", type: "link" },
    { name: "featured", type: "boolean" },
    { name: "order", type: "number" },
  ],
};

describe("isValidIdentifier", () => {
  it("accepts valid identifiers and rejects bad ones", () => {
    expect(isValidIdentifier("features")).toBe(true);
    expect(isValidIdentifier("_x$2")).toBe(true);
    expect(isValidIdentifier("2bad")).toBe(false);
    expect(isValidIdentifier("has-dash")).toBe(false);
    expect(isValidIdentifier("const")).toBe(false);
    expect(isValidIdentifier("")).toBe(false);
  });
});

describe("validateRepeaterInput", () => {
  it("passes a well-formed request", () => {
    expect(validateRepeaterInput(base)).toBeNull();
  });
  it("rejects bad names, duplicates, empties, and var==array", () => {
    expect(validateRepeaterInput({ ...base, arrayName: "2x" })).toMatch(/array name/);
    expect(validateRepeaterInput({ ...base, itemVar: "features" })).toMatch(/differ/);
    expect(validateRepeaterInput({ ...base, fields: [] })).toMatch(/at least one/);
    expect(
      validateRepeaterInput({
        ...base,
        fields: [
          { name: "a", type: "text" },
          { name: "a", type: "text" },
        ],
      })
    ).toMatch(/Duplicate/);
    expect(
      validateRepeaterInput({ ...base, fields: [{ name: "bad-name", type: "text" }] })
    ).toMatch(/valid field name/);
  });
});

describe("generateRepeaterSource", () => {
  it("builds a const array with one empty seed item, typed by field", () => {
    const { constBlock } = generateRepeaterSource(base);
    expect(constBlock).toContain("const features = [");
    expect(constBlock).toContain('title: "",');
    expect(constBlock).toContain('body: "",');
    expect(constBlock).toContain('image: "",');
    expect(constBlock).toContain('href: "",');
    expect(constBlock).toContain("featured: false,");
    expect(constBlock).toContain("order: 0,");
    expect(constBlock.trimEnd().endsWith("];")).toBe(true);
  });

  it("builds map markup with the binding and a heading for the first text field", () => {
    const { markup } = generateRepeaterSource(base);
    expect(markup).toContain("{features.map((feature) => (");
    expect(markup).toContain("<h3");
    expect(markup).toContain("{feature.title}");
    expect(markup).toContain("{feature.body}");
    expect(markup).toContain("src={feature.image}");
    expect(markup).toContain("href={feature.href}");
    // boolean + number render their bindings too
    expect(markup).toContain("{feature.featured &&");
    expect(markup).toContain("{feature.order}");
  });

  it("supports the stacked-list layout", () => {
    const { markup } = generateRepeaterSource({ ...base, layout: "stacked-list" });
    expect(markup).toContain("flex flex-col gap-4");
    expect(markup).toContain("{features.map((feature) => (");
  });
});
