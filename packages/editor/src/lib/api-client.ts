import type {
  FileInfo,
  ASTNode,
  Mutation,
  ProjectInfo,
  ContentFileInfo,
  ContentFile,
  ComponentPropSchema,
  ComponentSlotSchema,
  RecentProject,
  GitStatus,
  GitBranchInfo,
  GitDiffEntry,
  GitCommitInfo,
  TveBranchConfig,
  DevServerStartError,
  AssetInfo,
  SeoPageData,
  SeoPageResponse,
} from "@tve/shared";

const API_BASE = "/api";

/** URL for the raw bytes of a project asset (thumbnails in the image picker).
 *  Served by GET /api/assets/raw/*. relPath is project-relative, POSIX. */
export function assetRawUrl(relPath: string): string {
  return `${API_BASE}/assets/raw/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

const RAW_PUBLIC_ASSET_PREFIX = "/api/assets/raw/public";

function splitUrlSuffix(value: string): { pathPart: string; suffix: string } {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const cut = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (cut === undefined) return { pathPart: value, suffix: "" };
  return {
    pathPart: value.slice(0, cut),
    suffix: value.slice(cut),
  };
}

function decodeUrlPath(pathPart: string): string {
  return pathPart
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export function isProjectPublicAssetUrl(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/api/");
}

function currentEditorOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}

function sameOriginPublicAssetPath(value: string): string | null {
  const origin = currentEditorOrigin();
  if (!origin) return null;

  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return null;
    if (parsed.pathname.startsWith(RAW_PUBLIC_ASSET_PREFIX + "/")) {
      return parsed.pathname.slice(RAW_PUBLIC_ASSET_PREFIX.length) + parsed.search + parsed.hash;
    }
    if (parsed.pathname.startsWith("/api/")) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

export function projectPublicAssetPath(value: string): string | null {
  const src = value.trim();
  if (!src) return null;
  if (isProjectPublicAssetUrl(src)) return src;
  return sameOriginPublicAssetPath(src);
}

/** Resolve a saved public asset URL for display inside the editor app.
 *  Markdown should keep `/images/foo.webp`, but the editor preview must load
 *  those bytes through the backend because Vite does not serve project public/.
 */
export function projectAssetPreviewUrl(value: string): string {
  const publicPath = projectPublicAssetPath(value);
  if (!publicPath) return value;

  const { pathPart, suffix } = splitUrlSuffix(publicPath);
  return `${assetRawUrl(`public${decodeUrlPath(pathPart)}`)}${suffix}`;
}

export function normalizeProjectAssetUrlForSave(value: string): string {
  return projectPublicAssetPath(value) ?? value;
}

export function normalizeMarkdownProjectAssetUrls(markdown: string): string {
  return markdown
    .replace(
      /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi,
      (_match, prefix: string, quote: string, src: string, suffix: string) =>
        `${prefix}${quote}${normalizeProjectAssetUrlForSave(src)}${suffix}`
    )
    .replace(
      /(!\[[^\]]*\]\(<)([^>]+)(>\))/g,
      (_match, prefix: string, src: string, suffix: string) =>
        `${prefix}${normalizeProjectAssetUrlForSave(src)}${suffix}`
    )
    .replace(
      /(!\[[^\]]*\]\()([^\s)<>]+)((?:\s+(?:"[^"]*"|'[^']*'))?\))/g,
      (_match, prefix: string, src: string, suffix: string) =>
        `${prefix}${normalizeProjectAssetUrlForSave(src)}${suffix}`
    );
}

export function nullableProjectAssetPreviewUrl(value: string): string | null {
  const src = value.trim();
  if (!src) return null;
  if (projectPublicAssetPath(src)) return projectAssetPreviewUrl(src);
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  return null;
}

/** Error thrown when an API call returns a non-2xx response. Carries the
 *  optional error code so callers (e.g. promotion conflict prompt) can branch
 *  on it without parsing the message string. */
export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(err.error || res.statusText, res.status, err.code);
  }
  return res.json();
}

/** Encode a project-relative path for use in a URL segment without losing the
 *  `/` separators. Filenames with `#`, `?`, `%`, or spaces would otherwise
 *  break the route or get re-parsed as querystring/fragment. */
function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export const api = {
  /** Get project info */
  getProjectInfo(): Promise<ProjectInfo> {
    return fetchJson("/project/info");
  },

  /** List recent projects */
  getRecentProjects(): Promise<{ projects: RecentProject[] }> {
    return fetchJson("/project/recent");
  },

  /** Switch to a different local Astro project */
  switchProject(
    path: string
  ): Promise<{ path: string; name: string; hasNodeModules: boolean }> {
    return fetchJson("/project/switch", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },

  /** List all .astro files */
  getFiles(): Promise<{ files: FileInfo[] }> {
    return fetchJson("/files");
  },

  /** Get raw file content */
  getFileContent(path: string): Promise<{ path: string; content: string }> {
    return fetchJson(`/files/${encodePath(path)}`);
  },

  /** Frontmatter imports for a single .astro file. Used by AddElementPanel
   *  to surface package-imported components (Icon from astro-icon, etc.). */
  getFileImports(path: string): Promise<{
    imports: {
      name: string;
      source: string;
      isDefault: boolean;
      isExternal: boolean;
    }[];
  }> {
    return fetchJson(`/files/imports/${encodePath(path)}`);
  },

  /** Parse file into AST */
  getAst(path: string): Promise<{ path: string; ast: ASTNode[] }> {
    return fetchJson(`/ast/${encodePath(path)}`);
  },

  /** Apply a mutation to a file */
  applyMutation(
    path: string,
    mutation: Mutation
  ): Promise<{ success: boolean; ast?: ASTNode[]; error?: string }> {
    return fetchJson(`/mutations/${encodePath(path)}`, {
      method: "POST",
      body: JSON.stringify(mutation),
    });
  },

  /** Start the Astro dev server */
  startDevServer(): Promise<{ success: boolean; url?: string; error?: DevServerStartError | string }> {
    return fetchJson("/dev-server/start", { method: "POST" });
  },

  /** Get dev server status */
  getDevServerStatus(): Promise<{ status: string; url: string | null }> {
    return fetchJson("/dev-server/status");
  },

  /** Create a new Astro component */
  createComponent(
    name: string,
    template?: string
  ): Promise<{ success: boolean; path: string; name: string }> {
    return fetchJson("/components/create", {
      method: "POST",
      body: JSON.stringify({ name, template }),
    });
  },

  /** Create a new static .astro page under src/pages.
   *  `route` may include slashes for nested routes ("blog/welcome").
   *  template "layout" auto-detects the project's first src/layouts/*.astro
   *  and wraps the starter heading in it; falls back to "blank" otherwise. */
  createPage(
    route: string,
    template: "blank" | "layout"
  ): Promise<{
    success: boolean;
    path: string;
    route: string;
    layout: string | null;
  }> {
    return fetchJson("/pages/create", {
      method: "POST",
      body: JSON.stringify({ route, template }),
    });
  },

  /** Generate a preview page for a component */
  previewComponent(
    componentPath: string
  ): Promise<{ success: boolean; previewRoute: string }> {
    return fetchJson("/components/preview", {
      method: "POST",
      body: JSON.stringify({ componentPath }),
    });
  },

  /** Fetch the typed Props schema for a component by path */
  getComponentProps(componentPath: string): Promise<ComponentPropSchema> {
    const qs = encodeURIComponent(componentPath);
    return fetchJson(`/components/props?path=${qs}`);
  },

  /** Fetch the `<slot>` declarations a component exposes. Drives the tree's
   *  per-slot drop targets and the slot autocomplete on `slot=` attribute
   *  fields. */
  getComponentSlots(componentPath: string): Promise<ComponentSlotSchema> {
    const qs = encodeURIComponent(componentPath);
    return fetchJson(`/components/slots?path=${qs}`);
  },

  /** Get TVE project config (defaultMode, etc.) */
  getTveConfig(): Promise<{ defaultMode: "dev" | "marketer" }> {
    return fetchJson("/config/tve");
  },

  /** Get project Tailwind theme config */
  getTheme(): Promise<{ extend: Record<string, any>; content: string[] }> {
    return fetchJson("/config/theme");
  },

  /** Update tailwind.config theme.extend */
  updateTheme(extend: Record<string, any>): Promise<{ success: boolean }> {
    return fetchJson("/config/theme", {
      method: "POST",
      body: JSON.stringify({ extend }),
    });
  },

  /** Get design tokens */
  getTokens(): Promise<{ tokens: Record<string, any> }> {
    return fetchJson("/config/tokens");
  },

  /** Save design tokens */
  saveTokens(tokens: Record<string, any>): Promise<{ success: boolean }> {
    return fetchJson("/config/tokens", {
      method: "POST",
      body: JSON.stringify({ tokens }),
    });
  },

  /** List .md/.mdx files in the project */
  getContentFiles(): Promise<{ files: ContentFileInfo[] }> {
    return fetchJson("/content/list");
  },

  /** Read a markdown file into { frontmatter, body } */
  readContentFile(path: string): Promise<ContentFile> {
    return fetchJson(`/content/read/${encodePath(path)}`);
  },

  /** Write { frontmatter, body } back to disk */
  writeContentFile(
    path: string,
    frontmatter: Record<string, any>,
    body: string
  ): Promise<{ success: boolean }> {
    return fetchJson(`/content/write/${encodePath(path)}`, {
      method: "POST",
      body: JSON.stringify({ frontmatter, body }),
    });
  },

  /** Create a new .md/.mdx file in a content collection */
  createContentFile(input: {
    collection: string;
    slug: string;
    format: "md" | "mdx";
    root?: "src/content" | "src/pages" | "content";
    frontmatter?: Record<string, any>;
    body?: string;
  }): Promise<{ success: boolean; path: string }> {
    return fetchJson("/content/create", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** Extract an element into a new Astro component */
  extractComponent(
    sourceFile: string,
    nodeId: string,
    componentName: string
  ): Promise<{ success: boolean; componentPath: string; sourceAst: ASTNode[] }> {
    return fetchJson("/components/extract", {
      method: "POST",
      body: JSON.stringify({ sourceFile, nodeId, componentName }),
    });
  },

  /** Git: working-tree status (mode, branch, dirty files, ahead/behind) */
  getGitStatus(): Promise<GitStatus> {
    return fetchJson("/git/status");
  },

  /** Git: list local + remote branches */
  getGitBranches(): Promise<{ branches: GitBranchInfo[] }> {
    return fetchJson("/git/branches");
  },

  /** Git: working-tree diff per file */
  getGitDiff(): Promise<{ diff: GitDiffEntry[] }> {
    return fetchJson("/git/diff");
  },

  /** Git: recent commit log */
  getGitCommits(limit = 20): Promise<{ commits: GitCommitInfo[] }> {
    return fetchJson(`/git/commits?limit=${limit}`);
  },

  /** Git: stage + commit */
  gitCommit(message: string, files?: string[]): Promise<{ success: boolean; hash: string }> {
    return fetchJson("/git/commit", {
      method: "POST",
      body: JSON.stringify({ message, files }),
    });
  },

  /** Git: push current branch (or named branch) to origin */
  gitPush(opts: { branch?: string; setUpstream?: boolean } = {}): Promise<{ success: boolean }> {
    return fetchJson("/git/push", {
      method: "POST",
      body: JSON.stringify(opts),
    });
  },

  /** Git: pull from origin */
  gitPull(opts: { mode?: "ff-only" | "merge" | "rebase"; branch?: string } = {}): Promise<{ success: boolean }> {
    return fetchJson("/git/pull", {
      method: "POST",
      body: JSON.stringify(opts),
    });
  },

  /** Git: read .tve/config.json */
  getGitConfig(): Promise<TveBranchConfig> {
    return fetchJson("/git/config");
  },

  /** Git: write .tve/config.json (partial merge) */
  saveGitConfig(config: Partial<TveBranchConfig>): Promise<{ success: boolean; config: TveBranchConfig }> {
    return fetchJson("/git/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },

  /** Git: switch to an existing branch (refuses on dirty tree) */
  gitCheckout(branch: string): Promise<{ success: boolean }> {
    return fetchJson("/git/checkout", {
      method: "POST",
      body: JSON.stringify({ branch }),
    });
  },

  /** Git: create a new local branch (and optionally check it out) */
  gitCreateBranch(name: string, opts: { from?: string; checkout?: boolean } = {}): Promise<{ success: boolean }> {
    return fetchJson("/git/branch", {
      method: "POST",
      body: JSON.stringify({ name, ...opts }),
    });
  },

  /** Git: ensure the staging branch exists locally + on origin */
  gitEnsureStaging(): Promise<{ success: boolean; created: boolean; name: string; pushed: boolean }> {
    return fetchJson("/git/ensure-staging", { method: "POST" });
  },

  /** Git: merge `from` into `to`, push the target branch */
  gitPromote(opts: { from: string; to: string; ffOnly?: boolean; push?: boolean }): Promise<{
    success: boolean;
    method: "fast-forward" | "merge";
    pushed: boolean;
    currentBranch: string;
  }> {
    return fetchJson("/git/promote", {
      method: "POST",
      body: JSON.stringify(opts),
    });
  },

  /** GitHub auth: current sign-in state. Always returns 200 (with
   *  signedIn=false when no token is stored). */
  getAuthStatus(): Promise<{
    signedIn: boolean;
    user?: { login: string; id: number; avatarUrl: string | null } | null;
    installationId?: number | null;
    storedAt?: number;
    expiresAt?: number | null;
  }> {
    return fetchJson("/auth/whoami");
  },

  /** GitHub auth: clear the in-memory token. */
  authLogout(): Promise<{ signedIn: false }> {
    return fetchJson("/auth/logout", { method: "POST" });
  },

  /** GitHub: list the signed-in user's App installations. */
  listGithubInstallations(): Promise<{
    installations: Array<{
      id: number;
      account: { login: string; type: string; avatarUrl: string | null };
      repositorySelection: "all" | "selected";
      permissions: Record<string, string>;
    }>;
  }> {
    return fetchJson("/github/installations");
  },

  /** GitHub: list repos accessible via a given installation. */
  listGithubRepositories(installationId: number): Promise<{
    repositories: Array<{
      id: number;
      name: string;
      fullName: string;
      defaultBranch: string;
      private: boolean;
      description: string | null;
      htmlUrl: string;
      pushedAt: string | null;
    }>;
  }> {
    return fetchJson(`/github/installations/${installationId}/repositories`);
  },

  /** Project switch — kind="github" branch. Server clones the repo
   *  via the broker's installation token, validates, and switches the
   *  active project to the cached checkout. */
  switchProjectToGithub(input: {
    owner: string;
    repo: string;
    installationId: number;
    ref?: string;
  }): Promise<{
    path: string;
    name: string;
    hasNodeModules: boolean;
    source: "local" | "github";
  }> {
    return fetchJson("/project/switch", {
      method: "POST",
      body: JSON.stringify({ kind: "github", ...input }),
    });
  },

  /** List image assets in the project's public/ and src/ trees (image picker). */
  listAssets(): Promise<{ assets: AssetInfo[] }> {
    return fetchJson("/assets");
  },

  /** Upload an image into public/images/ and return the created asset. */
  async uploadAsset(file: File): Promise<{ success: boolean; asset: AssetInfo }> {
    const res = await fetch(
      `${API_BASE}/assets/upload?filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(err.error || res.statusText, res.status, err.code);
    }
    return res.json();
  },

  /** Read editable SEO/social metadata for an Astro page. */
  getSeoPage(path: string): Promise<SeoPageResponse> {
    return fetchJson(`/seo/page?path=${encodeURIComponent(path)}`);
  },

  /** Update an existing SEO source on an Astro page. */
  updateSeoPage(path: string, data: Partial<SeoPageData>): Promise<SeoPageResponse> {
    return fetchJson(`/seo/page?path=${encodeURIComponent(path)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /** Insert the configured SEO component on an Astro page, then return it. */
  addSeoPage(path: string, data: Partial<SeoPageData>): Promise<SeoPageResponse> {
    return fetchJson(`/seo/page/add?path=${encodeURIComponent(path)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
};
