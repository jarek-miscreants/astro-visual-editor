import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  getCollectionRouting,
  parseDynamicRoutePath,
  resolveEntryUrl,
} from "./collection-routing.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-cr-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFile(rel: string, body: string) {
  const full = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf-8");
}

describe("parseDynamicRoutePath", () => {
  it("parses a single-segment dynamic route", () => {
    expect(parseDynamicRoutePath("src/pages/blog/[slug].astro")).toEqual({
      dirParts: ["blog"],
      param: "slug",
      catchAll: false,
    });
  });

  it("parses a root-level dynamic route", () => {
    expect(parseDynamicRoutePath("src/pages/[slug].astro")).toEqual({
      dirParts: [],
      param: "slug",
      catchAll: false,
    });
  });

  it("flags catch-all routes", () => {
    expect(parseDynamicRoutePath("src/pages/blog/[...slug].astro")).toEqual({
      dirParts: ["blog"],
      param: "slug",
      catchAll: true,
    });
  });

  it("returns null for static pages", () => {
    expect(parseDynamicRoutePath("src/pages/about.astro")).toBeNull();
    expect(parseDynamicRoutePath("src/pages/index.astro")).toBeNull();
  });

  it("returns null for multi-param routes (no clean URL template)", () => {
    expect(parseDynamicRoutePath("src/pages/[lang]/blog/[slug].astro")).toBeNull();
  });

  it("returns null when the dynamic segment isn't last (we can't template it)", () => {
    expect(parseDynamicRoutePath("src/pages/[slug]/page.astro")).toBeNull();
  });
});

describe("getCollectionRouting", () => {
  it("classifies a routed collection from getCollection() in the dynamic page source", async () => {
    // Need at least one entry on disk for the collection to be discovered
    await writeFile("src/content/blog/post-a.md", "---\ntitle: A\n---\n");
    await writeFile(
      "src/pages/blog/[slug].astro",
      `---
import { getCollection } from "astro:content";
export async function getStaticPaths() {
  const posts = await getCollection("blog");
  return posts.map((p) => ({ params: { slug: p.slug } }));
}
---
<h1>Post</h1>
`
    );

    const map = await getCollectionRouting(tmpDir);
    const blog = map.get("blog");
    expect(blog).toBeDefined();
    expect(blog!.kind).toBe("routed");
    if (blog!.kind === "routed") {
      expect(blog!.routeFile).toBe("src/pages/blog/[slug].astro");
      expect(blog!.param).toBe("slug");
      expect(blog!.urlTemplate).toBe("/blog/{slug}");
      expect(blog!.isCatchAll).toBe(false);
    }
  });

  it("classifies an embedded collection (referenced from a static page only)", async () => {
    await writeFile("src/content/faq/q1.md", "---\nquestion: Q\n---\n");
    await writeFile(
      "src/pages/index.astro",
      `---
import { getCollection } from "astro:content";
const items = await getCollection('faq');
---
<ul>{items.map((i) => <li>{i.data.question}</li>)}</ul>
`
    );

    const map = await getCollectionRouting(tmpDir);
    const faq = map.get("faq");
    expect(faq).toBeDefined();
    expect(faq!.kind).toBe("embedded");
    if (faq!.kind === "embedded") {
      expect(faq!.pages).toContain("src/pages/index.astro");
    }
  });

  it("classifies an orphan collection (no references anywhere)", async () => {
    await writeFile("src/content/drafts/wip.md", "---\ntitle: WIP\n---\n");
    // No pages at all referencing 'drafts'
    await writeFile("src/pages/index.astro", `<h1>Home</h1>`);

    const map = await getCollectionRouting(tmpDir);
    const drafts = map.get("drafts");
    expect(drafts).toBeDefined();
    expect(drafts!.kind).toBe("orphan");
  });

  it("includes embedded usage of a routed collection (cards on home + posts at /blog/[slug])", async () => {
    await writeFile("src/content/blog/post-a.md", "---\ntitle: A\n---\n");
    await writeFile(
      "src/pages/blog/[slug].astro",
      `---
import { getCollection } from "astro:content";
export async function getStaticPaths() {
  return (await getCollection("blog")).map((p) => ({ params: { slug: p.slug } }));
}
---
`
    );
    await writeFile(
      "src/pages/index.astro",
      `---
import { getCollection } from "astro:content";
const recent = await getCollection("blog");
---
`
    );

    const map = await getCollectionRouting(tmpDir);
    const blog = map.get("blog");
    expect(blog!.kind).toBe("routed");
    if (blog!.kind === "routed") {
      expect(blog!.embeddedIn).toContain("src/pages/index.astro");
    }
  });

  it("resolveEntryUrl substitutes the slug into the template", async () => {
    await writeFile("src/content/blog/post-a.md", "---\ntitle: A\n---\n");
    await writeFile(
      "src/pages/blog/[slug].astro",
      `---
import { getCollection } from "astro:content";
const _ = await getCollection('blog');
---
`
    );
    const map = await getCollectionRouting(tmpDir);
    const blog = map.get("blog")!;
    expect(resolveEntryUrl(blog, "post-a")).toBe("/blog/post-a");
  });

  it("returns null URL for embedded/orphan collections", async () => {
    await writeFile("src/content/faq/q1.md", "---\nquestion: Q\n---\n");
    await writeFile(
      "src/pages/index.astro",
      `---
import { getCollection } from 'astro:content';
const items = await getCollection('faq');
---
`
    );
    const map = await getCollectionRouting(tmpDir);
    const faq = map.get("faq")!;
    expect(resolveEntryUrl(faq, "q1")).toBeNull();
  });
});
