import fs from "fs/promises";
import path from "path";
import type { FileInfo } from "@tve/shared";

/** Scan an Astro project for .astro files */
export async function scanProject(projectPath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  await scanDirectory(projectPath, projectPath, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function scanDirectory(
  dir: string,
  projectRoot: string,
  files: FileInfo[]
) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip common directories
    if (
      entry.isDirectory() &&
      !["node_modules", ".astro", "dist", ".git", ".next"].includes(entry.name)
    ) {
      await scanDirectory(fullPath, projectRoot, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".astro")) {
      const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
      const stat = await fs.stat(fullPath);

      let type: FileInfo["type"] = "component";
      if (relativePath.startsWith("src/pages/")) {
        type = "page";
      } else if (
        relativePath.startsWith("src/layouts/") ||
        entry.name.toLowerCase().includes("layout")
      ) {
        type = "layout";
      }

      files.push({
        path: relativePath,
        type,
        lastModified: stat.mtimeMs,
      });
    }
  }
}
