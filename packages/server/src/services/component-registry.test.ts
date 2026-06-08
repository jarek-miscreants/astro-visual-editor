import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { listComponentRegistry, getComponentRegistryEntry } from "./component-registry.js";

const tempRoots: string[] = [];

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tve-registry-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
  return root;
}

async function writeProjectFile(root: string, relPath: string, content: string) {
  const fullPath = path.join(root, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("component registry", () => {
  it("lists schematized components with marketer metadata", async () => {
    const project = await makeProject();

    await writeProjectFile(
      project,
      "src/components/Hero.astro",
      `---
interface Props {
  title: string;
  variant?: "split" | "centered";
}
---

<section>
  <h1>{title}</h1>
  <slot />
</section>
`
    );
    await writeProjectFile(
      project,
      "src/components/Hero.tve.ts",
      `export default defineTveComponent({
  label: "Marketing Hero",
  category: "Landing",
  description: "Primary campaign hero",
  thumbnail: "/images/hero-thumb.webp",
  insertable: true,
  defaultProps: {
    title: "Launch faster",
    variant: "split",
  },
  defaultChildren: "<p>Short supporting copy.</p>",
  fields: {
    title: {
      type: "text",
      label: "Headline",
      group: "Content",
      required: true,
      maxLength: 80,
    },
    eyebrow: {
      type: "text",
      label: "Eyebrow",
      group: "Content",
    },
  },
});`
    );

    await writeProjectFile(project, "src/components/Plain.astro", `<div>Plain</div>`);

    const components = await listComponentRegistry(project);
    const hero = components.find((component) => component.name === "Hero");
    const plain = components.find((component) => component.name === "Plain");

    expect(hero).toMatchObject({
      componentPath: "src/components/Hero.astro",
      tagName: "Hero",
      label: "Marketing Hero",
      category: "Landing",
      description: "Primary campaign hero",
      thumbnail: "/images/hero-thumb.webp",
      insertable: true,
      source: "tve-schema",
      fieldCount: 3,
      slotCount: 1,
      warnings: [],
    });
    expect(plain).toMatchObject({
      label: "Plain",
      category: "Components",
      insertable: false,
      source: "empty",
      fieldCount: 0,
      slotCount: 0,
    });

    const entry = await getComponentRegistryEntry(project, "src/components/Hero.astro");
    expect(entry.defaultProps).toEqual({ title: "Launch faster", variant: "split" });
    expect(entry.defaultChildren).toBe("<p>Short supporting copy.</p>");
    expect(entry.slots.slots).toEqual([{ name: null, hasFallback: false }]);
    expect(entry.props.fields.find((field) => field.name === "title")?.meta).toMatchObject({
      label: "Headline",
      group: "Content",
      maxLength: 80,
    });
    expect(entry.props.fields.find((field) => field.name === "eyebrow")).toMatchObject({
      kind: "string",
      name: "eyebrow",
      required: false,
    });
  });
});
