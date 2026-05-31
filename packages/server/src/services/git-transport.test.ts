import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture every simple-git instance so each test can assert which calls
// landed where. The factory must be defined inside `vi.mock` (vitest
// hoists `vi.mock` above imports), so we expose the spies via a module
// the test reads back.
vi.mock("simple-git", () => {
  const instances: Array<{
    cwd: string | undefined;
    push: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn>;
    clone: ReturnType<typeof vi.fn>;
  }> = [];
  const simpleGit = vi.fn((cwd?: string) => {
    const inst = {
      cwd,
      push: vi.fn(async () => {}),
      pull: vi.fn(async () => {}),
      fetch: vi.fn(async () => {}),
      clone: vi.fn(async () => {}),
    };
    instances.push(inst);
    return inst;
  });
  return { simpleGit, __instances: instances };
});

// Read the spy registry the mock just installed.
const simpleGitModule = (await import("simple-git")) as unknown as {
  simpleGit: ReturnType<typeof vi.fn>;
  __instances: Array<{
    cwd: string | undefined;
    push: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn>;
    clone: ReturnType<typeof vi.fn>;
  }>;
};

const { createAmbientGitTransport, getGitTransport, setGitTransport } = await import(
  "./git-transport.js"
);

beforeEach(() => {
  simpleGitModule.simpleGit.mockClear();
  simpleGitModule.__instances.length = 0;
});

describe("createAmbientGitTransport", () => {
  it("push() forwards repoPath and args to simpleGit().push", async () => {
    const t = createAmbientGitTransport();
    await t.push("/repo", ["--set-upstream", "origin", "main"]);

    expect(simpleGitModule.simpleGit).toHaveBeenCalledWith("/repo");
    const inst = simpleGitModule.__instances.at(-1)!;
    expect(inst.push).toHaveBeenCalledWith(["--set-upstream", "origin", "main"]);
  });

  it("push() with no args calls simpleGit().push(undefined) (matches pre-refactor behavior)", async () => {
    const t = createAmbientGitTransport();
    await t.push("/repo");
    expect(simpleGitModule.__instances.at(-1)!.push).toHaveBeenCalledWith(undefined);
  });

  it("push() with empty array still calls simpleGit().push(undefined)", async () => {
    // Pre-refactor: `args.length > 0 ? args : undefined` — preserve that
    // semantic so simple-git's "no extra args" path is taken instead of
    // `git push` getting an empty argv.
    const t = createAmbientGitTransport();
    await t.push("/repo", []);
    expect(simpleGitModule.__instances.at(-1)!.push).toHaveBeenCalledWith(undefined);
  });

  it("pull() forwards repoPath and args", async () => {
    const t = createAmbientGitTransport();
    await t.pull("/repo", ["--ff-only", "origin", "main"]);
    expect(simpleGitModule.simpleGit).toHaveBeenCalledWith("/repo");
    expect(simpleGitModule.__instances.at(-1)!.pull).toHaveBeenCalledWith([
      "--ff-only",
      "origin",
      "main",
    ]);
  });

  it("fetch() forwards repoPath and args", async () => {
    const t = createAmbientGitTransport();
    await t.fetch("/repo", ["--all"]);
    expect(simpleGitModule.simpleGit).toHaveBeenCalledWith("/repo");
    expect(simpleGitModule.__instances.at(-1)!.fetch).toHaveBeenCalledWith(["--all"]);
  });

  it("clone() forwards url, dest and args without binding a repoPath", async () => {
    const t = createAmbientGitTransport();
    await t.clone("https://example.com/r.git", "/dest", ["--depth", "1"]);
    // Clone has no repo cwd — simpleGit() called with no args.
    expect(simpleGitModule.simpleGit).toHaveBeenCalledWith();
    expect(simpleGitModule.__instances.at(-1)!.clone).toHaveBeenCalledWith(
      "https://example.com/r.git",
      "/dest",
      ["--depth", "1"]
    );
  });

  it("propagates errors from simple-git unchanged", async () => {
    const t = createAmbientGitTransport();
    const inst = {
      cwd: "/repo",
      push: vi.fn(async () => {
        throw new Error("non-fast-forward");
      }),
      pull: vi.fn(),
      fetch: vi.fn(),
      clone: vi.fn(),
    };
    simpleGitModule.simpleGit.mockImplementationOnce(() => inst);
    simpleGitModule.__instances.push(inst as any);

    await expect(t.push("/repo", ["origin", "main"])).rejects.toThrow(
      "non-fast-forward"
    );
  });
});

describe("getGitTransport / setGitTransport", () => {
  it("defaults to the ambient pass-through", async () => {
    const t = getGitTransport();
    await t.push("/repo", ["origin", "main"]);
    expect(simpleGitModule.__instances.at(-1)!.push).toHaveBeenCalledWith([
      "origin",
      "main",
    ]);
  });

  it("setGitTransport swaps the active instance", async () => {
    const calls: string[] = [];
    const fake = {
      push: vi.fn(async (repoPath: string) => {
        calls.push(`push:${repoPath}`);
      }),
      pull: vi.fn(async () => {}),
      fetch: vi.fn(async () => {}),
      clone: vi.fn(async () => {}),
    };
    const ambient = getGitTransport();
    try {
      setGitTransport(fake);
      await getGitTransport().push("/x");
      expect(calls).toEqual(["push:/x"]);
    } finally {
      setGitTransport(ambient);
    }
  });
});

const { createTokenGitTransport } = await import("./git-transport.js");

// simple-git's mock instance also has a `raw` method for the
// token-injection path. Patch the existing factory to add it on
// each instance.
beforeEach(() => {
  const origFactory = simpleGitModule.simpleGit;
  origFactory.mockImplementation((cwd?: string) => {
    const inst = {
      cwd,
      push: vi.fn(async () => {}),
      pull: vi.fn(async () => {}),
      fetch: vi.fn(async () => {}),
      clone: vi.fn(async () => {}),
      raw: vi.fn(async () => ""),
    };
    simpleGitModule.__instances.push(inst as any);
    return inst as any;
  });
});

describe("createTokenGitTransport", () => {
  it("push: injects http.extraheader with x-access-token credential", async () => {
    const source = {
      tokenFor: vi.fn(async () => "ghs_minted_token"),
    };
    const t = createTokenGitTransport(source);
    await t.push("/cloned-repo", ["origin", "main"]);

    expect(source.tokenFor).toHaveBeenCalledWith("/cloned-repo");

    const inst = simpleGitModule.__instances.at(-1)!;
    expect(inst.cwd).toBe("/cloned-repo");
    expect((inst as any).raw).toHaveBeenCalledTimes(1);
    const args = (inst as any).raw.mock.calls[0][0] as string[];
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^http\.extraheader=Authorization: Basic [A-Za-z0-9+/=]+$/);
    expect(args[2]).toBe("push");
    expect(args.slice(3)).toEqual(["origin", "main"]);

    // Verify the base64 credential decodes to `x-access-token:<token>`
    const headerValue = args[1].replace(/^http\.extraheader=Authorization: Basic /, "");
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    expect(decoded).toBe("x-access-token:ghs_minted_token");
  });

  it("pull: same injection pattern as push", async () => {
    const source = { tokenFor: vi.fn(async () => "tok_xyz") };
    const t = createTokenGitTransport(source);
    await t.pull("/repo", ["--ff-only"]);
    const inst = simpleGitModule.__instances.at(-1)!;
    const args = (inst as any).raw.mock.calls[0][0] as string[];
    expect(args[2]).toBe("pull");
    expect(args.slice(3)).toEqual(["--ff-only"]);
  });

  it("fetch: same injection pattern", async () => {
    const source = { tokenFor: vi.fn(async () => "tok_xyz") };
    const t = createTokenGitTransport(source);
    await t.fetch("/repo");
    const inst = simpleGitModule.__instances.at(-1)!;
    const args = (inst as any).raw.mock.calls[0][0] as string[];
    expect(args[2]).toBe("fetch");
  });

  it("falls back to ambient when source returns null (local-only repo)", async () => {
    const source = { tokenFor: vi.fn(async () => null) };
    const t = createTokenGitTransport(source);
    await t.push("/local-only", ["origin", "main"]);

    const inst = simpleGitModule.__instances.at(-1)!;
    // Ambient path: simpleGit().push(args), NOT raw.
    expect(inst.push).toHaveBeenCalledWith(["origin", "main"]);
    expect((inst as any).raw).not.toHaveBeenCalled();
  });

  it("clone: stays ambient (clone has no .tve-meta.json to read yet)", async () => {
    const source = { tokenFor: vi.fn(async () => "should-not-be-used") };
    const t = createTokenGitTransport(source);
    await t.clone("https://example.com/r.git", "/dest");

    expect(source.tokenFor).not.toHaveBeenCalled();
    const inst = simpleGitModule.__instances.at(-1)!;
    expect(inst.clone).toHaveBeenCalledWith("https://example.com/r.git", "/dest", undefined);
  });
});
