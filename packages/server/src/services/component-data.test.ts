import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  readComponentArrays,
  writeComponentArrayField,
  addComponentArrayItem,
  removeComponentArrayItem,
  moveComponentArrayItem,
} from "./component-data.js";

let tmpDir: string;

const COMPONENT = `---
import Button from "./Button.astro";

interface Props {
  class?: string;
}
const { class: className } = Astro.props;

const features = [
  {
    id: "security",
    title: "Isolated by default.",
    body: "Every workload runs in its own network.",
    featured: true,
    order: 1,
  },
  {
    id: "services",
    title: "Every service, one platform.",
    body: "Databases, queues, vectors as services.",
    featured: false,
    order: 2,
  },
];
---

<section class={className}>
  {features.map((feature) => (
    <article>
      <h3>{feature.title}</h3>
      <p>{feature.body}</p>
    </article>
  ))}
</section>
`;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-cd-"));
  await fs.writeFile(path.join(tmpDir, "FeatureGrid.astro"), COMPONENT, "utf-8");
});

describe("readComponentArrays", () => {
  it("extracts the const array, its fields and literal values", async () => {
    const result = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    expect(result.arrays).toHaveLength(1);
    const arr = result.arrays[0];
    expect(arr.name).toBe("features");
    expect(arr.count).toBe(2);
    expect(arr.fields).toEqual(["id", "title", "body", "featured", "order"]);
    expect(arr.items[0]).toEqual({
      id: "security",
      title: "Isolated by default.",
      body: "Every workload runs in its own network.",
      featured: true,
      order: 1,
    });
    expect(arr.items[1].title).toBe("Every service, one platform.");
  });

  it("parses the .map() loop binding (arrayName ↔ itemVar)", async () => {
    const result = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    expect(result.loopBindings).toContainEqual({
      arrayName: "features",
      itemVar: "feature",
    });
  });

  it("returns no arrays for a component without object-literal arrays", async () => {
    await fs.writeFile(
      path.join(tmpDir, "Plain.astro"),
      `---\nconst x = 1;\n---\n<p>{x}</p>\n`,
      "utf-8"
    );
    const result = await readComponentArrays(tmpDir, "Plain.astro");
    expect(result.arrays).toHaveLength(0);
  });
});

describe("writeComponentArrayField", () => {
  it("rewrites a string field surgically", async () => {
    const res = await writeComponentArrayField(tmpDir, "FeatureGrid.astro", {
      arrayName: "features",
      index: 1,
      field: "title",
      value: "Renamed service.",
    });
    expect(res.success).toBe(true);

    const out = await fs.readFile(path.join(tmpDir, "FeatureGrid.astro"), "utf-8");
    expect(out).toContain('title: "Renamed service."');
    // First item + the binding usage untouched.
    expect(out).toContain('title: "Isolated by default."');
    expect(out).toContain("{feature.title}");

    // Re-reading reflects the change.
    const reread = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    expect(reread.arrays[0].items[1].title).toBe("Renamed service.");
  });

  it("escapes quotes without corrupting the file", async () => {
    const res = await writeComponentArrayField(tmpDir, "FeatureGrid.astro", {
      arrayName: "features",
      index: 0,
      field: "body",
      value: 'He said "hi" to all',
    });
    expect(res.success).toBe(true);
    const reread = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    expect(reread.arrays[0].items[0].body).toBe('He said "hi" to all');
  });

  it("coerces and writes a number field as a bare literal", async () => {
    const res = await writeComponentArrayField(tmpDir, "FeatureGrid.astro", {
      arrayName: "features",
      index: 0,
      field: "order",
      value: "5",
    });
    expect(res.success).toBe(true);
    const out = await fs.readFile(path.join(tmpDir, "FeatureGrid.astro"), "utf-8");
    expect(out).toContain("order: 5");
    expect(out).not.toContain('order: "5"');
  });

  it("rejects an unknown array, field or index", async () => {
    expect(
      (await writeComponentArrayField(tmpDir, "FeatureGrid.astro", {
        arrayName: "features",
        index: 0,
        field: "nope",
        value: "x",
      })).success
    ).toBe(false);
    expect(
      (await writeComponentArrayField(tmpDir, "FeatureGrid.astro", {
        arrayName: "features",
        index: 9,
        field: "title",
        value: "x",
      })).success
    ).toBe(false);
  });
});

describe("addComponentArrayItem", () => {
  it("appends an empty item matching the array's field shape", async () => {
    const res = await addComponentArrayItem(tmpDir, "FeatureGrid.astro", "features");
    expect(res.success).toBe(true);

    const reread = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    const arr = reread.arrays[0];
    expect(arr.count).toBe(3);
    // New item has every field, emptied by kind.
    expect(arr.items[2]).toEqual({
      id: "",
      title: "",
      body: "",
      featured: false,
      order: 0,
    });
    // Existing items untouched.
    expect(arr.items[0].title).toBe("Isolated by default.");
  });

  it("produces source that still parses and preserves earlier items", async () => {
    await addComponentArrayItem(tmpDir, "FeatureGrid.astro", "features");
    const out = await fs.readFile(path.join(tmpDir, "FeatureGrid.astro"), "utf-8");
    expect(out).toContain('title: "Isolated by default."');
    expect(out).toContain("{feature.title}");
    // The new empty literals are present.
    expect(out).toMatch(/title:\s*"",/);
  });
});

describe("removeComponentArrayItem", () => {
  it("removes the targeted item and leaves the rest intact", async () => {
    const res = await removeComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 0);
    expect(res.success).toBe(true);

    const reread = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    expect(reread.arrays[0].count).toBe(1);
    expect(reread.arrays[0].items[0].id).toBe("services");
    const out = await fs.readFile(path.join(tmpDir, "FeatureGrid.astro"), "utf-8");
    expect(out).not.toContain('id: "security"');
    // No blank line / dangling comma left behind that would break parsing.
    expect(out).not.toMatch(/,\s*,/);
  });

  it("add then remove round-trips back to the original shape", async () => {
    await addComponentArrayItem(tmpDir, "FeatureGrid.astro", "features");
    let arr = (await readComponentArrays(tmpDir, "FeatureGrid.astro")).arrays[0];
    expect(arr.count).toBe(3);
    await removeComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 2);
    arr = (await readComponentArrays(tmpDir, "FeatureGrid.astro")).arrays[0];
    expect(arr.count).toBe(2);
    expect(arr.items.map((i) => i.id)).toEqual(["security", "services"]);
  });

  it("rejects an out-of-range index", async () => {
    expect(
      (await removeComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 9)).success
    ).toBe(false);
  });
});

describe("moveComponentArrayItem", () => {
  it("swaps an item down with its neighbour (preserving each item's fields)", async () => {
    const res = await moveComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 0, "down");
    expect(res.success).toBe(true);

    const arr = (await readComponentArrays(tmpDir, "FeatureGrid.astro")).arrays[0];
    expect(arr.items.map((i) => i.id)).toEqual(["services", "security"]);
    // Full item content rode along with the move (not just the title).
    expect(arr.items[0].title).toBe("Every service, one platform.");
    expect(arr.items[1].body).toBe("Every workload runs in its own network.");
  });

  it("moving up mirrors moving down", async () => {
    await moveComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 1, "up");
    const arr = (await readComponentArrays(tmpDir, "FeatureGrid.astro")).arrays[0];
    expect(arr.items.map((i) => i.id)).toEqual(["services", "security"]);
  });

  it("keeps the source valid and bindings intact after a move", async () => {
    await moveComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 0, "down");
    const data = await readComponentArrays(tmpDir, "FeatureGrid.astro");
    expect(data.loopBindings).toContainEqual({ arrayName: "features", itemVar: "feature" });
    const out = await fs.readFile(path.join(tmpDir, "FeatureGrid.astro"), "utf-8");
    expect(out).toContain("{feature.title}");
  });

  it("rejects moving past the ends", async () => {
    expect(
      (await moveComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 0, "up")).success
    ).toBe(false);
    expect(
      (await moveComponentArrayItem(tmpDir, "FeatureGrid.astro", "features", 1, "down")).success
    ).toBe(false);
  });
});
