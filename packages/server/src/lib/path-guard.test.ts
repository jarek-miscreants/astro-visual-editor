import { describe, it, expect } from "vitest";
import path from "path";
import { resolveProjectPath, PathTraversalError } from "./path-guard.js";

describe("resolveProjectPath", () => {
  const project = path.resolve("/projects/my-app");

  describe("allows", () => {
    it.each([
      ["src/pages/index.astro"],
      ["src/components/Button.astro"],
      ["nested/very/deep/file.txt"],
      ["./src/index.ts"],
      ["src/./index.ts"],
      [""], // resolves to project root itself
    ])("%s", (input) => {
      expect(() => resolveProjectPath(project, input)).not.toThrow();
    });

    it("returns absolute path inside the project", () => {
      const out = resolveProjectPath(project, "src/foo.ts");
      expect(out).toBe(path.resolve(project, "src/foo.ts"));
    });

    it("collapses internal `..` that stays inside", () => {
      const out = resolveProjectPath(project, "src/../package.json");
      expect(out).toBe(path.resolve(project, "package.json"));
    });
  });

  describe("blocks", () => {
    it.each([
      ["../etc/passwd"],
      ["../../escape"],
      ["src/../../escape"],
      // Absolute paths outside the project resolve outside, must be blocked
      [path.resolve("/etc/passwd")],
      [path.resolve("/projects/other-app/file")],
    ])("%s", (input) => {
      expect(() => resolveProjectPath(project, input)).toThrow(PathTraversalError);
    });

    it("blocks sibling-prefix attacks (project=/p/foo, target=/p/foobar)", () => {
      // A naive startsWith check would let `/projects/my-app-evil` slip through.
      // The guard requires a path separator after the project root to prevent that.
      const sibling = path.resolve("/projects/my-app-evil/file");
      expect(() => resolveProjectPath(project, sibling)).toThrow(PathTraversalError);
    });
  });

  describe("error", () => {
    it("PathTraversalError carries the offending input in the message", () => {
      try {
        resolveProjectPath(project, "../../escape");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PathTraversalError);
        expect((err as Error).message).toContain("../../escape");
      }
    });
  });
});
