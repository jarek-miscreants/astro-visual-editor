import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { getLinkTargets } from "./link-targets.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-link-targets-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFile(rel: string, body: string) {
  const full = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf-8");
}

describe("getLinkTargets", () => {
  it("discovers static pages and collection-backed page URLs", async () => {
    await writeFile("src/pages/index.astro", "<h1>Home</h1>");
    await writeFile("src/pages/about.astro", "<h1>About</h1>");
    await writeFile("src/pages/tve-preview.astro", "<h1>Preview</h1>");
    await writeFile(
      "src/pages/blog/[slug].astro",
      `---
import { getCollection } from "astro:content";
export async function getStaticPaths() {
  return (await getCollection("blog")).map((post) => ({
    params: { slug: post.data.slug ?? post.slug },
  }));
}
---
<article>Post</article>
`
    );
    await writeFile(
      "src/content/blog/hello-world.md",
      `---
title: Hello World
slug: hello-seo
---
Content
`
    );
    await writeFile(
      "src/content/blog/nested/post.md",
      `---
title: Nested Post
---
Content
`
    );

    const targets = await getLinkTargets(tmpDir);

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "page",
          group: "Pages",
          label: "/",
          url: "/",
          sourcePath: "src/pages/index.astro",
        }),
        expect.objectContaining({
          kind: "page",
          group: "Pages",
          label: "/about",
          url: "/about",
          sourcePath: "src/pages/about.astro",
        }),
        expect.objectContaining({
          kind: "content",
          group: "Blog (/blog/{slug})",
          label: "Hello World",
          url: "/blog/hello-seo",
          collection: "blog",
          sourcePath: "src/content/blog/hello-world.md",
          routeFile: "src/pages/blog/[slug].astro",
        }),
      ])
    );
    expect(targets.some((target) => target.url === "/tve-preview")).toBe(false);
    expect(targets.some((target) => target.url === "/blog/nested/post")).toBe(false);
  });

  it("uses catch-all routes for nested collection slugs", async () => {
    await writeFile(
      "src/pages/docs/[...slug].astro",
      `---
import { getCollection } from "astro:content";
const docs = await getCollection("docs");
---
<article>{docs.length}</article>
`
    );
    await writeFile(
      "src/content/docs/guides/install.md",
      `---
title: Install Guide
---
Content
`
    );

    const targets = await getLinkTargets(tmpDir);

    expect(targets).toContainEqual(
      expect.objectContaining({
        kind: "content",
        group: "Docs (/docs/{slug})",
        label: "Install Guide",
        url: "/docs/guides/install",
        collection: "docs",
      })
    );
  });

  it("shows unresolved dynamic routes as disabled template options", async () => {
    await writeFile(
      "src/pages/[lang]/blog/[slug].astro",
      `---
import { getCollection } from "astro:content";
const posts = await getCollection("blog");
---
<article>{posts.length}</article>
`
    );
    await writeFile("src/content/blog/post.md", "---\ntitle: Post\n---\n");

    const targets = await getLinkTargets(tmpDir);

    expect(targets).toContainEqual(
      expect.objectContaining({
        kind: "template",
        group: "Templates",
        url: "/[lang]/blog/[slug]",
        disabled: true,
        routeFile: "src/pages/[lang]/blog/[slug].astro",
      })
    );
  });
});
