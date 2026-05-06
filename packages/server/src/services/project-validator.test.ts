import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  validateLocalProject,
  validateRemoteRepo,
  type ValidationResult,
} from "./project-validator.js";

let tmpDir: string;

async function writeFile(p: string, content: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

async function touch(p: string) {
  await writeFile(p, "");
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tve-validator-"));
});

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("validateLocalProject", () => {
  it("accepts an Astro + Tailwind v3 project", async () => {
    await touch(path.join(tmpDir, "astro.config.mjs"));
    await touch(path.join(tmpDir, "tailwind.config.mjs"));
    const result = await validateLocalProject(tmpDir);
    expect(result).toEqual({ ok: true, tailwindVersion: 3 });
  });

  it("accepts an Astro + Tailwind v4 project (CSS @theme)", async () => {
    await touch(path.join(tmpDir, "astro.config.mjs"));
    await writeFile(
      path.join(tmpDir, "src/styles/global.css"),
      `@import "tailwindcss";\n@theme { --color-brand: #ff00ff; }\n`
    );
    const result = await validateLocalProject(tmpDir);
    expect(result).toEqual({ ok: true, tailwindVersion: 4 });
  });

  it("accepts an Astro + Tailwind v4 project via @import alone", async () => {
    await touch(path.join(tmpDir, "astro.config.mjs"));
    await writeFile(
      path.join(tmpDir, "src/styles/global.css"),
      `@import "tailwindcss";\n`
    );
    const result = await validateLocalProject(tmpDir);
    expect(result).toEqual({ ok: true, tailwindVersion: 4 });
  });

  it("finds v4 CSS in a non-default location via recursive search", async () => {
    await touch(path.join(tmpDir, "astro.config.mjs"));
    // Not in CSS_ENTRY_FILES — must hit findV4Stylesheet().
    await writeFile(
      path.join(tmpDir, "src/assets/styles/theme.css"),
      `@theme { --color-brand: red; }\n`
    );
    const result = await validateLocalProject(tmpDir);
    expect(result).toEqual({ ok: true, tailwindVersion: 4 });
  });

  it("rejects when astro.config is missing", async () => {
    await touch(path.join(tmpDir, "tailwind.config.mjs"));
    const result = await validateLocalProject(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-astro-config");
    }
  });

  it("rejects when astro.config exists but Tailwind is missing", async () => {
    await touch(path.join(tmpDir, "astro.config.mjs"));
    const result = await validateLocalProject(tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-tailwind");
    }
  });

  it("rejects symlink escapes outside the project root", async () => {
    if (process.platform === "win32") return; // Skip — symlink creation requires admin/dev mode on Windows.

    await touch(path.join(tmpDir, "astro.config.mjs"));
    await touch(path.join(tmpDir, "tailwind.config.mjs"));

    // Create something outside the tmpDir, then symlink to it.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "tve-outside-"));
    try {
      const linkPath = path.join(tmpDir, "evil");
      await fs.symlink(outside, linkPath);
      const result = await validateLocalProject(tmpDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("symlink-escape");
      }
    } finally {
      await fs.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("ignores broken symlinks (not an escape)", async () => {
    if (process.platform === "win32") return;

    await touch(path.join(tmpDir, "astro.config.mjs"));
    await touch(path.join(tmpDir, "tailwind.config.mjs"));
    const linkPath = path.join(tmpDir, "broken");
    await fs.symlink(path.join(tmpDir, "does-not-exist"), linkPath);
    const result = await validateLocalProject(tmpDir);
    expect(result.ok).toBe(true);
  });

  it("does not descend into node_modules during recursive CSS search", async () => {
    await touch(path.join(tmpDir, "astro.config.mjs"));
    // Tailwind marker hidden in node_modules — must NOT trigger ok.
    await writeFile(
      path.join(tmpDir, "node_modules/some-pkg/dist/index.css"),
      `@import "tailwindcss";\n`
    );
    const result = await validateLocalProject(tmpDir);
    expect(result.ok).toBe(false);
  });
});

describe("validateRemoteRepo", () => {
  function mockFetch(handlers: Record<string, { status: number; body: any }>) {
    return async (url: string | URL | Request, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const handler = handlers[u];
      if (!handler) {
        return new Response("Not configured in test", { status: 404 });
      }
      const isJson = typeof handler.body !== "string";
      return new Response(isJson ? JSON.stringify(handler.body) : handler.body, {
        status: handler.status,
        headers: { "content-type": isJson ? "application/json" : "text/plain" },
      });
    };
  }

  it("accepts an Astro + Tailwind v3 repo", async () => {
    const fetchImpl = mockFetch({
      "https://api.github.com/repos/acme/site/contents": {
        status: 200,
        body: [
          { name: "astro.config.mjs", type: "file", path: "astro.config.mjs" },
          { name: "tailwind.config.mjs", type: "file", path: "tailwind.config.mjs" },
          { name: "package.json", type: "file", path: "package.json" },
        ],
      },
    });
    const result = await validateRemoteRepo({ owner: "acme", repo: "site", fetchImpl });
    expect(result).toEqual({ ok: true, tailwindVersion: 3 });
  });

  it("accepts an Astro + Tailwind v4 repo via recursive CSS probe", async () => {
    const fetchImpl = mockFetch({
      "https://api.github.com/repos/acme/site/contents": {
        status: 200,
        body: [
          { name: "astro.config.mjs", type: "file", path: "astro.config.mjs" },
          { name: "src", type: "dir", path: "src" },
        ],
      },
      "https://api.github.com/repos/acme/site/contents/src": {
        status: 200,
        body: [{ name: "global.css", type: "file", path: "src/global.css" }],
      },
      "https://raw.githubusercontent.com/acme/site/HEAD/src/global.css": {
        status: 200,
        body: `@import "tailwindcss";\n`,
      },
    });
    const result = await validateRemoteRepo({ owner: "acme", repo: "site", fetchImpl });
    expect(result).toEqual({ ok: true, tailwindVersion: 4 });
  });

  it("rejects a repo with no astro.config", async () => {
    const fetchImpl = mockFetch({
      "https://api.github.com/repos/acme/api/contents": {
        status: 200,
        body: [{ name: "package.json", type: "file", path: "package.json" }],
      },
    });
    const result = await validateRemoteRepo({ owner: "acme", repo: "api", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-astro-config");
  });

  it("rejects a repo with astro but no Tailwind", async () => {
    const fetchImpl = mockFetch({
      "https://api.github.com/repos/acme/site/contents": {
        status: 200,
        body: [
          { name: "astro.config.mjs", type: "file", path: "astro.config.mjs" },
          { name: "src", type: "dir", path: "src" },
        ],
      },
      "https://api.github.com/repos/acme/site/contents/src": {
        status: 200,
        body: [{ name: "index.astro", type: "file", path: "src/index.astro" }],
      },
    });
    const result = await validateRemoteRepo({ owner: "acme", repo: "site", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-tailwind");
  });

  it("rejects a repo over the size cap", async () => {
    const fetchImpl = mockFetch({}); // never called — size check happens first
    const result = await validateRemoteRepo({
      owner: "acme",
      repo: "huge",
      sizeKb: 600 * 1024, // 600 MB
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
  });

  it("forwards a token via Authorization header", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push(headers.Authorization ?? "no-auth");
      return new Response(
        JSON.stringify([
          { name: "astro.config.mjs", type: "file", path: "astro.config.mjs" },
          { name: "tailwind.config.mjs", type: "file", path: "tailwind.config.mjs" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    await validateRemoteRepo({ owner: "acme", repo: "site", token: "ghs_abc", fetchImpl });
    expect(calls[0]).toBe("Bearer ghs_abc");
  });
});
