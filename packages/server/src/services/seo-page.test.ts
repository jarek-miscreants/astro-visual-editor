import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { addSeoToPage, analyzeSeoPage } from "./seo-page.js";

async function writeFile(root: string, relPath: string, content: string) {
  const fullPath = path.join(root, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function fixtureProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tve-seo-"));
  await writeFile(
    root,
    "src/layouts/Layout.astro",
    `---
interface Props {
  title?: string;
}
const { title = "Fallback" } = Astro.props;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
`
  );
  await writeFile(
    root,
    "src/pages/index.astro",
    `---
import Layout from "../layouts/Layout.astro";
---
<Layout title="Home">
  <main>Home</main>
</Layout>
`
  );
  return root;
}

describe("seo-page", () => {
  it("offers automatic insertion when no SEO config exists", async () => {
    const project = await fixtureProject();

    const seo = await analyzeSeoPage(project, "src/pages/index.astro");

    expect(seo.found).toBe(false);
    expect(seo.canInsert).toBe(true);
    expect(seo.warnings.find((warning) => warning.code === "seo-missing")).toBeUndefined();
  });

  it("creates the SEO component and layout head slot before inserting", async () => {
    const project = await fixtureProject();

    const seo = await addSeoToPage(project, "src/pages/index.astro", {
      title: "Home title",
      description: "Home description",
      noindex: true,
    });

    const page = await fs.readFile(path.join(project, "src/pages/index.astro"), "utf-8");
    const layout = await fs.readFile(path.join(project, "src/layouts/Layout.astro"), "utf-8");
    const component = await fs.readFile(path.join(project, "src/components/SEO.astro"), "utf-8");

    expect(seo.found).toBe(true);
    expect(page).toContain('import SEO from "../components/SEO.astro";');
    expect(page).toContain('<Fragment slot="head">');
    expect(page).toContain('<SEO title="Home title" description="Home description" noindex="true" />');
    expect(layout).toContain('<slot name="head">');
    expect(layout).toContain("<title>{title}</title>");
    expect(component).toContain("interface Props");
    expect(component).toContain('property="og:title"');
  });
});
