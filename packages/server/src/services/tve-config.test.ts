import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { readTveProjectConfig } from "./tve-config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-config-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(config: unknown) {
  await fs.writeFile(
    path.join(tmpDir, "tve.config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

describe("readTveProjectConfig", () => {
  it("returns defaults when tve.config.json is missing", async () => {
    await expect(readTveProjectConfig(tmpDir)).resolves.toEqual({
      defaultMode: "dev",
    });
  });

  it("normalizes nested content view folders and collection links", async () => {
    await writeConfig({
      defaultMode: "marketer",
      contentView: [
        {
          id: "publishing",
          label: "Publishing",
          children: [
            {
              collection: "blog",
              label: "Blog posts",
              description: "Editorial articles",
            },
            {
              collection: "whitepapers",
              label: "White papers",
              defaultRoot: "src/content",
            },
          ],
        },
        {
          label: "Supporting content",
          items: [{ collection: "authors" }],
        },
      ],
    });

    await expect(readTveProjectConfig(tmpDir)).resolves.toEqual({
      defaultMode: "marketer",
      contentView: [
        {
          type: "folder",
          id: "publishing",
          label: "Publishing",
          items: [
            {
              type: "collection",
              collection: "blog",
              label: "Blog posts",
              description: "Editorial articles",
            },
            {
              type: "collection",
              collection: "whitepapers",
              label: "White papers",
              defaultRoot: "src/content",
            },
          ],
        },
        {
          type: "folder",
          label: "Supporting content",
          items: [
            {
              type: "collection",
              collection: "authors",
            },
          ],
        },
      ],
    });
  });

  it("skips invalid content view entries without dropping valid ones", async () => {
    await writeConfig({
      contentView: [
        null,
        { label: "No items" },
        { collection: "" },
        { collection: "blog", root: "invalid" },
      ],
    });

    await expect(readTveProjectConfig(tmpDir)).resolves.toEqual({
      defaultMode: "dev",
      contentView: [
        {
          type: "collection",
          collection: "blog",
        },
      ],
    });
  });
});
