import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  deleteContentFile,
  readContentFile,
  scanContentFiles,
  writeContentFile,
} from "./content-files.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-content-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(rel: string, body: string) {
  const full = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf-8");
}

describe("scanContentFiles", () => {
  it("discovers markdown files outside conventional content roots", async () => {
    await writeFixture("README.md", "# Home\n");
    await writeFixture("docs/guides/install.md", "---\ntitle: Install\n---\nStart here.\n");
    await writeFixture("src/content/blog/post.mdx", "---\ntitle: Post\n---\n<Post />\n");
    await writeFixture("node_modules/pkg/ignored.md", "# ignored\n");
    await writeFixture("src/pages/index.astro", "<h1>Not markdown</h1>\n");

    const files = await scanContentFiles(tmpDir);

    expect(files.map((f) => f.path)).toEqual([
      "docs/guides/install.md",
      "README.md",
      "src/content/blog/post.mdx",
    ]);
    expect(files.find((f) => f.path === "docs/guides/install.md")?.collection).toBe("docs");
    expect(files.find((f) => f.path === "README.md")?.collection).toBe("root");
    expect(files.find((f) => f.path === "src/content/blog/post.mdx")?.collection).toBe("blog");
  });

  it("extracts lightweight frontmatter metadata for collection lists", async () => {
    await writeFixture(
      "src/content/blog/post.md",
      "---\ntitle: Launch Notes\ndescription: Product update\npublishedAt: 2026-06-08\ndraft: true\nstatus: review\n---\nBody\n"
    );

    const files = await scanContentFiles(tmpDir);

    expect(files[0]).toMatchObject({
      path: "src/content/blog/post.md",
      collection: "blog",
      slug: "post",
      title: "Launch Notes",
      description: "Product update",
      date: "2026-06-08",
      draft: true,
      status: "review",
    });
  });
});

describe("content file read/write", () => {
  it("allows arbitrary markdown paths inside the project", async () => {
    await writeFixture("docs/page.md", "---\ntitle: Old\n---\nOld body\n");

    const file = await readContentFile(tmpDir, "docs/page.md");
    expect(file.frontmatter).toEqual({ title: "Old" });
    expect(file.body).toBe("Old body\n");

    await writeContentFile(tmpDir, "docs/page.md", { title: "New" }, "New body\n");
    await expect(fs.readFile(path.join(tmpDir, "docs/page.md"), "utf-8")).resolves.toContain(
      "New body"
    );
  });

  it("rejects non-markdown paths", async () => {
    await writeFixture("src/pages/index.astro", "<h1>Keep me</h1>\n");

    await expect(
      writeContentFile(tmpDir, "src/pages/index.astro", { title: "Bad" }, "bad\n")
    ).rejects.toThrow("Content editor only supports .md and .mdx files");

    await expect(readContentFile(tmpDir, "src/pages/index.astro")).rejects.toThrow(
      "Content editor only supports .md and .mdx files"
    );
  });
});

describe("deleteContentFile", () => {
  it("deletes markdown and mdx entries inside the project", async () => {
    await writeFixture("src/content/blog/post.mdx", "---\ntitle: Post\n---\n<Post />\n");

    await deleteContentFile(tmpDir, "src/content/blog/post.mdx");

    await expect(
      fs.access(path.join(tmpDir, "src/content/blog/post.mdx"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-markdown paths", async () => {
    await writeFixture("src/pages/index.astro", "<h1>Keep me</h1>\n");

    await expect(deleteContentFile(tmpDir, "src/pages/index.astro")).rejects.toThrow(
      "Content editor only supports .md and .mdx files"
    );
    await expect(fs.readFile(path.join(tmpDir, "src/pages/index.astro"), "utf-8")).resolves.toBe(
      "<h1>Keep me</h1>\n"
    );
  });

  it("blocks path traversal", async () => {
    await expect(deleteContentFile(tmpDir, "../outside.md")).rejects.toThrow(
      "Path traversal blocked"
    );
  });
});
