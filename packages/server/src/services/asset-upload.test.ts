import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  sanitizeAssetFilename,
  saveUploadedPublicAsset,
} from "./asset-upload.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-asset-upload-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("sanitizeAssetFilename", () => {
  it("normalizes names while preserving the extension", () => {
    expect(sanitizeAssetFilename("Hero Image FINAL.webp")).toBe("hero-image-final.webp");
    expect(sanitizeAssetFilename("!.png")).toBe("image.png");
  });
});

describe("saveUploadedPublicAsset", () => {
  it("writes uploads into public/images and returns a public URL", async () => {
    const asset = await saveUploadedPublicAsset(
      tmpDir,
      "Hero Image.PNG",
      Buffer.from("png-bytes")
    );

    expect(asset).toMatchObject({
      relPath: "public/images/hero-image.png",
      name: "hero-image.png",
      ext: ".png",
      location: "public",
      publicUrl: "/images/hero-image.png",
      size: 9,
    });
    await expect(
      fs.readFile(path.join(tmpDir, "public/images/hero-image.png"), "utf-8")
    ).resolves.toBe("png-bytes");
  });

  it("de-dupes existing filenames", async () => {
    await saveUploadedPublicAsset(tmpDir, "hero.webp", Buffer.from("first"));
    const second = await saveUploadedPublicAsset(tmpDir, "hero.webp", Buffer.from("second"));

    expect(second.relPath).toBe("public/images/hero-2.webp");
    await expect(
      fs.readFile(path.join(tmpDir, "public/images/hero-2.webp"), "utf-8")
    ).resolves.toBe("second");
  });

  it("rejects non-image extensions and empty files", async () => {
    await expect(
      saveUploadedPublicAsset(tmpDir, "notes.txt", Buffer.from("nope"))
    ).rejects.toThrow("Unsupported image type");

    await expect(
      saveUploadedPublicAsset(tmpDir, "empty.png", Buffer.alloc(0))
    ).rejects.toThrow("Uploaded image is empty");
  });
});
