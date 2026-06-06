/** AST node representing an HTML element in an .astro file */
export interface ASTNode {
  /** Unique identifier: tve-{fileHash8}-{index} */
  nodeId: string;
  /** HTML tag name (div, p, h1, etc.) or component name */
  tagName: string;
  /** Whether this is an Astro component (PascalCase) */
  isComponent: boolean;
  /** CSS classes string */
  classes: string;
  /** If class is bound via a JSX expression (e.g. `class={classes}`), the
   *  raw expression text in `{...}` form. Mutually exclusive with `classes`. */
  classExpression?: string | null;
  /** Text content (for text-only nodes) */
  textContent: string | null;
  /** Untrimmed raw inner text of a `<style>`/`<script>` block. Populated only
   *  for those elements so the raw-content editor can load the exact body and
   *  the undo inverse can restore it byte-for-byte. null for everything else. */
  rawTextContent?: string | null;
  /** HTML attributes */
  attributes: Record<string, string>;
  /** Child nodes */
  children: ASTNode[];
  /** Source file position */
  position: SourcePosition;
  /** Whether this node is inside a dynamic expression */
  isDynamic: boolean;
}

export interface SourcePosition {
  start: { offset: number; line: number; column: number };
  end: { offset: number; line: number; column: number };
}

/** Info about a file in the project */
export interface FileInfo {
  /** Relative path from project root */
  path: string;
  /** File type */
  type: "page" | "layout" | "component";
  /** Last modified timestamp */
  lastModified: number;
}

/** Element info sent from iframe to editor on selection */
export interface ElementInfo {
  nodeId: string;
  tagName: string;
  classes: string;
  textContent: string | null;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  computedStyles: {
    display: string;
    position: string;
    padding: string;
    margin: string;
    fontSize: string;
    color: string;
    backgroundColor: string;
  };
}

/** Mutation types for modifying source files */
export type Mutation =
  | { type: "update-classes"; nodeId: string; classes: string }
  | { type: "update-text"; nodeId: string; text: string }
  | { type: "update-raw-content"; nodeId: string; content: string }
  | {
      type: "update-attribute";
      nodeId: string;
      attr: string;
      value: string | null;
    }
  | {
      type: "add-element";
      parentNodeId: string;
      position: number;
      html: string;
      componentPath?: string;
    }
  | { type: "remove-element"; nodeId: string }
  | {
      type: "move-element";
      nodeId: string;
      newParentId: string;
      newPosition: number;
    }
  | {
      type: "duplicate-element";
      nodeId: string;
    }
  | {
      type: "wrap-element";
      nodeId: string;
      wrapperTag: string;
      wrapperClasses?: string;
    };

/** Inverse of a mutation for undo */
export type MutationWithInverse = {
  mutation: Mutation;
  inverse: Mutation;
};

/** Info about a markdown/mdx content file */
export interface ContentFileInfo {
  path: string;
  collection: string;
  format: "md" | "mdx";
  lastModified: number;
}

/** A parsed markdown/mdx file */
export interface ContentFile {
  path: string;
  frontmatter: Record<string, any>;
  body: string;
  format: "md" | "mdx";
}

/** Which project tree an image asset was found in. `public/` assets are
 *  URL-addressable as plain strings; `src/` assets require a frontmatter
 *  import and so can only be previewed, not applied to a plain `src=""`. */
export type AssetLocation = "public" | "src";

/** An image asset discovered by the server's asset scanner, used by the
 *  image picker. */
export interface AssetInfo {
  /** Path relative to the project root, POSIX-separated (e.g. `public/images/foo.webp`). */
  relPath: string;
  /** Bare filename (e.g. `foo.webp`). */
  name: string;
  /** Lowercase extension including the dot (e.g. `.webp`). */
  ext: string;
  /** Which scan root this asset came from. */
  location: AssetLocation;
  /** The string to write into a plain `src=""` — the production URL for
   *  `public/` assets (e.g. `/images/foo.webp`); null for `src/` assets,
   *  which need an import and can't be referenced by a plain string. */
  publicUrl: string | null;
  /** File size in bytes. */
  size: number;
}

/** Dev server status */
export type DevServerStatus = "stopped" | "starting" | "running" | "error";

/** Structured reason why the Astro dev server failed to start. Produced by
 *  the server-side preflight (astro sync) so the editor can show actionable
 *  errors instead of a generic "Failed to start". */
export type DevServerStartError =
  | {
      kind: "schema";
      message: string;
      collection?: string;
      entry?: string;
      file?: string;
      missingFields?: string[];
      raw: string;
    }
  | {
      kind: "config";
      message: string;
      file?: string;
      raw: string;
    }
  | {
      kind: "syntax";
      message: string;
      file?: string;
      line?: number;
      raw: string;
    }
  | {
      kind: "missing-dep";
      message: string;
      dep?: string;
      raw: string;
    }
  | {
      kind: "port";
      message: string;
      port?: number;
      raw: string;
    }
  | {
      kind: "unknown";
      message: string;
      raw: string;
    };

/** Project info returned by the API */
export interface ProjectInfo {
  path: string | null;
  name: string | null;
  hasAstro?: boolean;
  hasTailwind?: boolean;
  /** Server runtime mode. `cli` is the original CLI dev tool flow;
   * `desktop` is the Electron-shell flow added during the local-SaaS
   * migration. Routes/screens gated on this flag are no-ops in `cli`. */
  mode?: "cli" | "desktop";
}

export interface RecentProject {
  path: string;
  name: string;
}

/**
 * Discriminated payload for `POST /api/project/switch`. Phase 1 wires
 * the type so the editor and server agree on the shape; the `github`
 * branch is intentionally inert until Phase 2 lands the GitHub clone
 * flow (and returns `501 Not Implemented` until then).
 *
 * For backwards compatibility, the route also still accepts the legacy
 * `{ path }` shape and treats it as `{ kind: "local", path }`.
 */
export type ProjectSwitchPayload =
  | { kind: "local"; path: string }
  | {
      kind: "github";
      owner: string;
      repo: string;
      ref?: string;
      /** Numeric GitHub App installation_id with access to this repo.
       *  The picker UI knows which installation it pulled the repo
       *  from, so it can pass it directly. The server uses this to
       *  request an installation token from the broker. */
      installationId: number;
    };

export interface ProjectSwitchResponse {
  path: string;
  name: string;
  hasNodeModules: boolean;
  /** `local` mirrors the original CLI flow; `github` is the Phase 2
   *  branch — clone progress will stream over the WebSocket. */
  source: "local" | "github";
}

/**
 * Typed prop extracted from a component's TypeScript Props interface.
 * Every variant carries an optional jsdoc string so the editor can show the
 * author's prop documentation (the leading doc comment above each property
 * in the Props interface) as a tooltip / help text.
 */
export type ComponentPropField =
  | {
      kind: "enum";
      name: string;
      required: boolean;
      options: string[];
      default?: string;
      jsdoc?: string;
      meta?: ComponentPropMeta;
    }
  | {
      /**
       * Numeric union like 1 | 2 | 3 ... | 12. Renders as a select with
       * numeric options; rejects out-of-range entries. The values are stored
       * as strings in attributes (Astro stringifies numeric props in the
       * template), so the editor still writes them as strings; options drives
       * validation and the dropdown labels.
       */
      kind: "number-enum";
      name: string;
      required: boolean;
      options: number[];
      default?: number;
      jsdoc?: string;
      meta?: ComponentPropMeta;
    }
  | {
      kind: "boolean";
      name: string;
      required: boolean;
      default?: boolean;
      jsdoc?: string;
      meta?: ComponentPropMeta;
    }
  | {
      kind: "string";
      name: string;
      required: boolean;
      default?: string;
      jsdoc?: string;
      meta?: ComponentPropMeta;
    }
  | {
      kind: "number";
      name: string;
      required: boolean;
      default?: number;
      jsdoc?: string;
      meta?: ComponentPropMeta;
    }
  | {
      kind: "unknown";
      name: string;
      required: boolean;
      typeText: string;
      jsdoc?: string;
      meta?: ComponentPropMeta;
    };

export interface ComponentPropSchema {
  /** Relative path to the component file */
  componentPath: string;
  /** Ordered list of props */
  fields: ComponentPropField[];
  /** Component-level display metadata from optional Component.tve.ts files. */
  meta?: ComponentEditorMeta;
  /** Non-fatal schema parsing warnings. */
  warnings?: string[];
}

export type ComponentControlKind =
  | "text"
  | "textarea"
  | "richText"
  | "image"
  | "link"
  | "choice"
  | "boolean"
  | "number";

export interface ComponentChoiceOption {
  value: string;
  label: string;
}

export interface ComponentPropMeta {
  label?: string;
  group?: string;
  description?: string;
  placeholder?: string;
  control?: ComponentControlKind;
  required?: boolean;
  hidden?: boolean;
  advanced?: boolean;
  maxLength?: number;
  choices?: ComponentChoiceOption[];
}

export interface ComponentEditorMeta {
  label?: string;
  category?: string;
  description?: string;
}

export interface SeoPageData {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterImage: string;
  noindex: boolean;
}

export type SeoAdapterKind = "component" | "layout-props" | "head-tags" | "none";

export interface SeoFieldState {
  value: string | boolean | null;
  writable: boolean;
  reason?: string;
  source?: {
    kind: "component-prop" | "layout-prop" | "head-tag";
    nodeId?: string;
    prop?: string;
  };
}

export interface SeoWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface SeoPageResponse {
  path: string;
  editable: boolean;
  adapter: SeoAdapterKind;
  found: boolean;
  canInsert: boolean;
  data: Partial<SeoPageData>;
  fields: Record<keyof SeoPageData, SeoFieldState>;
  warnings: SeoWarning[];
}

/**
 * A slot declaration parsed from a component source. name === null is the
 * default (unnamed) slot. hasFallback is true when the slot tag wraps fallback
 * content (a paired tag with non-whitespace content between open and close).
 * The editor uses hasFallback to render a "shows fallback when empty" hint
 * instead of a bare empty target.
 */
export interface ComponentSlotDef {
  name: string | null;
  hasFallback: boolean;
}

export interface ComponentSlotSchema {
  componentPath: string;
  slots: ComponentSlotDef[];
}

/**
 * Operating mode for the git layer in the current project.
 * - `no-git`     project directory is not a git repo
 * - `local-only` repo exists but has no remote (push/pull disabled)
 * - `connected`  repo has a remote, full draft → staging → main flow
 */
export type GitMode = "no-git" | "local-only" | "connected";

/** A file that is dirty (modified, added, deleted, etc.) in the working tree */
export interface GitDirtyFile {
  /** Path relative to the repo root */
  path: string;
  /** Single-letter porcelain status: M, A, D, R, ??, etc. */
  status: string;
  /** Convenience flag: true when status indicates an untracked file (??) */
  untracked: boolean;
}

export interface GitStatus {
  mode: GitMode;
  /** Currently checked out branch name (null when detached or no-git) */
  currentBranch: string | null;
  /** Default branch on origin (e.g. "main"). null when local-only/no-git */
  defaultBranch: string | null;
  /** Commits the current branch is ahead of its tracking branch */
  ahead: number;
  /** Commits behind */
  behind: number;
  dirty: GitDirtyFile[];
  /** True when the working tree has any modifications, staged or not */
  hasChanges: boolean;
  /** When the last fetch from origin happened, ISO timestamp; null if unknown */
  lastFetchAt: string | null;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  /** True when this branch is on origin */
  remote: boolean;
  /** True when there is also a local branch tracking this remote */
  hasLocal: boolean;
  /** Last commit subject for quick identification */
  lastCommitSubject?: string;
}

export interface GitDiffEntry {
  path: string;
  status: string;
  /** Patch text (may be empty for untracked binaries) */
  patch: string;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

/**
 * Persisted in the repo at `.tve/config.json`. Defines branch roles for the
 * draft → staging → production promotion model. Missing file falls back to
 * sensible defaults; production branch resolves from origin/HEAD.
 *
 * Publishing roles are defined by the project owner, lead developer, or repo
 * admin in `.tve/config.json`. Entries are GitHub usernames. Anyone with a
 * local checkout can edit this file for their own app session, so these roles
 * are UI/workflow hints only. GitHub permissions, branch protection, and
 * CODEOWNERS remain the source of truth for what can be pushed or merged.
 */
export interface TveBranchConfig {
  branches: {
    production: string;
    staging: string;
    draftPrefix: string;
  };
  git: {
    autoCommitMode: "staged" | "per-mutation";
    ffOnly: boolean;
    deleteDraftAfterMerge: boolean;
  };
  publishing: {
    /** Who TVE should offer production/main publishing controls to. */
    productionMode: "admins-only" | "any-signed-in" | "anyone";
    /** The default branch target for content users. */
    defaultTarget: "staging" | "production";
    /** Prefix for future review/draft branches created by TVE. */
    reviewBranchPrefix: string;
  };
  roles: {
    /** GitHub logins that can use production publishing controls in TVE. */
    admins: string[];
    /** GitHub logins that can publish to staging/review targets. */
    publishers: string[];
    /** GitHub logins that can review proposed content changes. */
    reviewers: string[];
  };
}
