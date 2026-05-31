import { describe, it, expect } from "vitest";
import { loadGithubAppConfig } from "./github-app-config.js";

const goodEnv = {
  GITHUB_APP_ID: "3625760",
  GITHUB_APP_CLIENT_ID: "Iv23liYBl4uHyTNnpQzO",
  GITHUB_APP_SLUG: "tailwind-visual-editor",
};

describe("loadGithubAppConfig", () => {
  it("returns null when all three public values are unset", () => {
    expect(loadGithubAppConfig({})).toBeNull();
  });

  it("returns a parsed config when all three are set", () => {
    const cfg = loadGithubAppConfig(goodEnv);
    expect(cfg).not.toBeNull();
    expect(cfg!.appId).toBe(3625760);
    expect(cfg!.clientId).toBe("Iv23liYBl4uHyTNnpQzO");
    expect(cfg!.slug).toBe("tailwind-visual-editor");
    expect(cfg!.installUrl).toBe(
      "https://github.com/apps/tailwind-visual-editor/installations/new"
    );
    expect(cfg!.brokerBaseUrl).toBeNull();
  });

  it("attaches broker URL when provided, stripping trailing slash", () => {
    const cfg = loadGithubAppConfig({
      ...goodEnv,
      GITHUB_APP_BROKER_URL: "https://broker.example.com/",
    });
    expect(cfg!.brokerBaseUrl).toBe("https://broker.example.com");
  });

  it("throws on partial config (only some of the three set)", () => {
    expect(() =>
      loadGithubAppConfig({
        GITHUB_APP_ID: "3625760",
        GITHUB_APP_CLIENT_ID: "Iv23liYBl4uHyTNnpQzO",
      })
    ).toThrow(/GITHUB_APP_SLUG/);

    expect(() =>
      loadGithubAppConfig({
        GITHUB_APP_SLUG: "tailwind-visual-editor",
      })
    ).toThrow(/GITHUB_APP_ID, GITHUB_APP_CLIENT_ID/);
  });

  it("treats whitespace-only values as unset", () => {
    expect(
      loadGithubAppConfig({
        GITHUB_APP_ID: "   ",
        GITHUB_APP_CLIENT_ID: "",
        GITHUB_APP_SLUG: "  ",
      })
    ).toBeNull();
  });

  it("rejects a non-integer App ID", () => {
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_ID: "abc" })
    ).toThrow(/positive integer/);
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_ID: "0" })
    ).toThrow(/positive integer/);
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_ID: "-5" })
    ).toThrow(/positive integer/);
  });

  it("rejects a malformed slug", () => {
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_SLUG: "-leading-hyphen" })
    ).toThrow(/slug/);
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_SLUG: "trailing-hyphen-" })
    ).toThrow(/slug/);
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_SLUG: "has spaces" })
    ).toThrow(/slug/);
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_SLUG: "has/slash" })
    ).toThrow(/slug/);
  });

  it("rejects a malformed Client ID (paste-error guard)", () => {
    expect(() =>
      loadGithubAppConfig({
        ...goodEnv,
        GITHUB_APP_CLIENT_ID: "Iv23l iYBl4uHyTNnpQzO", // space
      })
    ).toThrow(/CLIENT_ID/);
  });

  it("rejects a non-URL broker value", () => {
    expect(() =>
      loadGithubAppConfig({ ...goodEnv, GITHUB_APP_BROKER_URL: "not-a-url" })
    ).toThrow(/BROKER_URL/);
    expect(() =>
      loadGithubAppConfig({
        ...goodEnv,
        GITHUB_APP_BROKER_URL: "ftp://example.com",
      })
    ).toThrow(/http/);
  });

  it("install URL is derived from the slug", () => {
    const cfg = loadGithubAppConfig({
      ...goodEnv,
      GITHUB_APP_SLUG: "some-other-app",
    });
    expect(cfg!.installUrl).toBe(
      "https://github.com/apps/some-other-app/installations/new"
    );
  });
});
