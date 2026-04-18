import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

export interface ContentFileInfo {
  path: string;
  collection: string;
  format: "md" | "mdx";
  lastModified: number;
}

export interface ContentFile {
  path: string;
  frontmatter: Record<string, any>;
  body: string;
  format: "md" | "mdx";
}

const CONTENT_ROOTS = ["src/content", "src/pages", "content"];
const EXCLUDED_DIRS = new Set(["node_modules", ".astro", "dist", ".git", ".next"]);

/** Scan the project for .md / .mdx files under conventional content roots */
export async function scanContentFiles(projectPath: string): Promise<ContentFileInfo[]> {
  const out: ContentFileInfo[] = [];

  for (const root of CONTENT_ROOTS) {
    const abs = path.join(projectPath, root);
    try {
      await walk(abs, projectPath, out);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(dir: string, projectRoot: string, out: ContentFileInfo[]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walk(full, projectRoot, out);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".md" && ext !== ".mdx") continue;

    const rel = path.relative(projectRoot, full).replace(/\\/g, "/");
    const stat = await fs.stat(full);
    out.push({
      path: rel,
      collection: deriveCollection(rel),
      format: ext === ".mdx" ? "mdx" : "md",
      lastModified: stat.mtimeMs,
    });
  }
}

function deriveCollection(relPath: string): string {
  // src/content/blog/foo.md → "blog"
  // src/pages/blog/foo.md → "blog"
  // content/foo.md → "content"
  const parts = relPath.split("/");
  if (parts[0] === "src" && (parts[1] === "content" || parts[1] === "pages") && parts.length >= 4) {
    return parts[2];
  }
  if (parts[0] === "content" && parts.length >= 3) {
    return parts[1];
  }
  return "root";
}

export async function readContentFile(
  projectPath: string,
  relPath: string
): Promise<ContentFile> {
  const full = path.join(projectPath, relPath);
  const raw = await fs.readFile(full, "utf-8");
  const parsed = matter(raw);
  const ext = path.extname(relPath).toLowerCase();
  return {
    path: relPath,
    frontmatter: parsed.data,
    body: parsed.content,
    format: ext === ".mdx" ? "mdx" : "md",
  };
}

export async function writeContentFile(
  projectPath: string,
  relPath: string,
  frontmatter: Record<string, any>,
  body: string
): Promise<void> {
  const full = path.join(projectPath, relPath);
  // matter.stringify normalizes line endings and handles YAML serialization,
  // preserving quoting style for the fields it controls.
  const out = matter.stringify(body, frontmatter);
  await fs.writeFile(full, out, "utf-8");
}
