import type {
  FileInfo,
  ASTNode,
  Mutation,
  ProjectInfo,
  ContentFileInfo,
  ContentFile,
  ComponentPropSchema,
  RecentProject,
  GitStatus,
  GitBranchInfo,
  GitDiffEntry,
  GitCommitInfo,
  TveBranchConfig,
} from "@tve/shared";

const API_BASE = "/api";

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
    return fetchJson(`/files/${path}`);
  },

  /** Parse file into AST */
  getAst(path: string): Promise<{ path: string; ast: ASTNode[] }> {
    return fetchJson(`/ast/${path}`);
  },

  /** Apply a mutation to a file */
  applyMutation(
    path: string,
    mutation: Mutation
  ): Promise<{ success: boolean; ast?: ASTNode[]; error?: string }> {
    return fetchJson(`/mutations/${path}`, {
      method: "POST",
      body: JSON.stringify(mutation),
    });
  },

  /** Start the Astro dev server */
  startDevServer(): Promise<{ success: boolean; url?: string; error?: string }> {
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
    return fetchJson(`/content/read/${path}`);
  },

  /** Write { frontmatter, body } back to disk */
  writeContentFile(
    path: string,
    frontmatter: Record<string, any>,
    body: string
  ): Promise<{ success: boolean }> {
    return fetchJson(`/content/write/${path}`, {
      method: "POST",
      body: JSON.stringify({ frontmatter, body }),
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
};
