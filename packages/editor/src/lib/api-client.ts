import type { FileInfo, ASTNode, Mutation, ProjectInfo } from "@tve/shared";

const API_BASE = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  /** Get project info */
  getProjectInfo(): Promise<ProjectInfo> {
    return fetchJson("/project/info");
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
};
