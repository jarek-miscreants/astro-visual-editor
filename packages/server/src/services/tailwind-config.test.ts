import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  detectTailwindVersion,
  readTailwindConfig,
  writeCssTheme,
  readDesignTokens,
  writeDesignTokens,
} from "./tailwind-config.js";

let tmpDir: string;

async function writeFile(p: string, content: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-tw-"));
});

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("detectTailwindVersion", () => {
  it("returns v4 when CSS contains @theme", async () => {
    await writeFile(
      path.join(tmpDir, "src/styles/global.css"),
      `@import "tailwindcss";\n@theme {\n  --color-brand: #ff00ff;\n}\n`
    );
    const result = await detectTailwindVersion(tmpDir);
    expect(result.version).toBe(4);
    expect(result.cssPath).toContain("global.css");
    expect(result.configPath).toBeNull();
  });

  it("returns v4 when CSS imports tailwindcss without @theme block", async () => {
    await writeFile(
      path.join(tmpDir, "src/styles/global.css"),
      `@import "tailwindcss";\n`
    );
    const result = await detectTailwindVersion(tmpDir);
    expect(result.version).toBe(4);
  });

  it("returns v3 when tailwind.config.mjs exists and no v4 css", async () => {
    await writeFile(
      path.join(tmpDir, "tailwind.config.mjs"),
      `export default { content: ["./src/**/*.astro"], theme: { extend: {} } };`
    );
    const result = await detectTailwindVersion(tmpDir);
    expect(result.version).toBe(3);
    expect(result.configPath).toContain("tailwind.config.mjs");
    expect(result.cssPath).toBeNull();
  });

  it("returns v3 with no paths when nothing matches", async () => {
    const result = await detectTailwindVersion(tmpDir);
    expect(result.version).toBe(3);
    expect(result.configPath).toBeNull();
    expect(result.cssPath).toBeNull();
  });

  it("prefers v4 over v3 when both signals exist (CSS @theme wins)", async () => {
    await writeFile(
      path.join(tmpDir, "src/styles/global.css"),
      `@theme {\n  --color-brand: red;\n}\n`
    );
    await writeFile(
      path.join(tmpDir, "tailwind.config.mjs"),
      `export default { theme: {} };`
    );
    const result = await detectTailwindVersion(tmpDir);
    expect(result.version).toBe(4);
  });
});

describe("readTailwindConfig (v3 JS config)", () => {
  it("reads theme.extend from tailwind.config.mjs", async () => {
    await writeFile(
      path.join(tmpDir, "tailwind.config.mjs"),
      `export default { content: ["./src/**/*.astro"], theme: { extend: { colors: { brand: "#ff0000" } } } };`
    );
    const result = await readTailwindConfig(tmpDir);
    expect(result.version).toBe(3);
    expect(result.extend.colors?.brand).toBe("#ff0000");
  });

  it("returns empty extend when no config file exists", async () => {
    const result = await readTailwindConfig(tmpDir);
    expect(result.version).toBe(3);
    expect(result.extend).toEqual({});
  });
});

describe("readTailwindConfig (v4 CSS @theme)", () => {
  it("parses CSS variables from @theme block", async () => {
    await writeFile(
      path.join(tmpDir, "src/styles/global.css"),
      `@import "tailwindcss";\n\n@theme {\n  --color-brand: #ff00ff;\n  --font-size-hero: 4rem;\n}\n`
    );
    const result = await readTailwindConfig(tmpDir);
    expect(result.version).toBe(4);
    expect(result.cssTheme).toMatchObject({
      "color-brand": "#ff00ff",
      "font-size-hero": "4rem",
    });
  });
});

describe("writeCssTheme", () => {
  it("creates a new @theme block when missing", async () => {
    const cssPath = path.join(tmpDir, "src/styles/global.css");
    await writeFile(cssPath, `@import "tailwindcss";\n`);

    await writeCssTheme(cssPath, { "color-primary": "#3b82f6" });

    const out = await fs.readFile(cssPath, "utf-8");
    expect(out).toContain("@theme {");
    expect(out).toContain("--color-primary: #3b82f6;");
  });

  it("replaces an existing @theme block in place", async () => {
    const cssPath = path.join(tmpDir, "src/styles/global.css");
    await writeFile(
      cssPath,
      `@import "tailwindcss";\n\n@theme {\n  --color-old: red;\n}\n\n.unrelated { color: red; }\n`
    );

    await writeCssTheme(cssPath, { "color-new": "#00ff00" });

    const out = await fs.readFile(cssPath, "utf-8");
    expect(out).toContain("--color-new: #00ff00;");
    expect(out).not.toContain("--color-old");
    // Surrounding rules untouched
    expect(out).toContain(".unrelated { color: red; }");
  });
});

describe("readDesignTokens / writeDesignTokens", () => {
  it("returns null when no tokens file exists", async () => {
    expect(await readDesignTokens(tmpDir)).toBeNull();
  });

  it("round-trips tokens through writeDesignTokens", async () => {
    // Need a v3 config so writeDesignTokens has somewhere to sync colors
    await writeFile(
      path.join(tmpDir, "tailwind.config.mjs"),
      `export default { content: [], theme: { extend: {} } };`
    );

    await writeDesignTokens(tmpDir, {
      colors: { primary: "blue-600", error: "red-500" },
      typography: { scale: { lg: "1.125rem" } },
    });

    const read = await readDesignTokens(tmpDir);
    expect(read).toMatchObject({
      colors: { primary: "blue-600", error: "red-500" },
    });
  });

  it("syncs token colors into the v4 CSS @theme block", async () => {
    const cssPath = path.join(tmpDir, "src/styles/global.css");
    await writeFile(cssPath, `@import "tailwindcss";\n`);

    await writeDesignTokens(tmpDir, {
      colors: { primary: "blue-600" },
    });

    const css = await fs.readFile(cssPath, "utf-8");
    expect(css).toContain("--color-primary: var(--color-blue-600);");
  });
});
