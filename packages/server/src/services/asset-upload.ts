import fs from "fs/promises";
import path from "path";
import type { AssetInfo } from "@tve/shared";
import { IMAGE_EXTENSIONS } from "./asset-scanner.js";
import { resolveProjectPath } from "../lib/path-guard.js";

const DEFAULT_UPLOAD_DIR = "public/images";

export function sanitizeAssetFilename(filename: string): string {
  const parsed = path.parse(filename);
  const ext = parsed.ext.toLowerCase();
  const base = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "image"}${ext}`;
}

async function pathExists(fullPath: string): Promise<boolean> {
  try {
    await fs.access(fullPath);
    return true;
  } catch (err: any) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

async function uniquePath(dir: string, filename: string): Promise<string> {
  const parsed = path.parse(filename);
  let candidate = filename;
  let index = 2;

  while (await pathExists(path.join(dir, candidate))) {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }

  return candidate;
}

export async function saveUploadedPublicAsset(
  projectPath: string,
  filename: string,
  data: Buffer
): Promise<AssetInfo> {
  const safeName = sanitizeAssetFilename(filename);
  const ext = path.extname(safeName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type");
  }
  if (data.length === 0) {
    throw new Error("Uploaded image is empty");
  }

  const uploadDir = resolveProjectPath(projectPath, DEFAULT_UPLOAD_DIR);
  await fs.mkdir(uploadDir, { recursive: true });

  const uniqueName = await uniquePath(uploadDir, safeName);
  const relPath = `${DEFAULT_UPLOAD_DIR}/${uniqueName}`;
  const fullPath = resolveProjectPath(projectPath, relPath);

  await fs.writeFile(fullPath, data);

  return {
    relPath,
    name: uniqueName,
    ext,
    location: "public",
    publicUrl: `/images/${uniqueName}`,
    size: data.length,
  };
}
