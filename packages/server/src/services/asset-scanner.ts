import fs from "fs/promises";
import path from "path";
import type { AssetInfo, AssetLocation } from "@tve/shared";

export type { AssetInfo, AssetLocation } from "@tve/shared";

/** Image extensions we surface in the asset picker. */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
]);

/** Directories we never descend into while scanning for assets. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".astro",
  "dist",
  ".git",
  ".vercel",
  ".netlify",
]);

/** Top-level project directories scanned for image assets. `public/` assets
 *  are URL-addressable as plain strings (e.g. `/images/foo.webp`); `src/`
 *  assets are not (they need a frontmatter import), so they're surfaced for
 *  preview only with `publicUrl: null`. */
const SCAN_ROOTS: { dir: string; location: AssetLocation }[] = [
  { dir: "public", location: "public" },
  { dir: "src", location: "src" },
];

/** Recursively scan the project's `public/` and `src/` trees for image files.
 *  Results are sorted by location (public first) then path. */
export async function scanAssets(projectPath: string): Promise<AssetInfo[]> {
  const assets: AssetInfo[] = [];

  for (const root of SCAN_ROOTS) {
    const absRoot = path.join(projectPath, root.dir);
    await walk(absRoot, root, projectPath, assets);
  }

  assets.sort((a, b) => {
    if (a.location !== b.location) return a.location === "public" ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
  return assets;
}

async function walk(
  absDir: string,
  root: { dir: string; location: AssetLocation },
  projectPath: string,
  out: AssetInfo[]
): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist (e.g. no `public/`) — skip silently.
    return;
  }

  for (const entry of entries) {
    // Skip dotfiles and dot-directories (build artifacts, .DS_Store, temp files).
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      await walk(absPath, root, projectPath, out);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    let size = 0;
    try {
      size = (await fs.stat(absPath)).size;
    } catch {
      // Stat failed (race / permission) — leave size 0 rather than drop the asset.
    }

    const relPath = path.relative(projectPath, absPath).split(path.sep).join("/");
    // For `public/foo/bar.webp` the production URL is `/foo/bar.webp`.
    const publicUrl =
      root.location === "public" ? "/" + relPath.slice("public/".length) : null;

    out.push({
      relPath,
      name: entry.name,
      ext,
      location: root.location,
      publicUrl,
      size,
    });
  }
}

/** Map an extension to a MIME type for raw asset serving. */
export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

export { IMAGE_EXTENSIONS };
