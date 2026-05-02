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
}

export interface RecentProject {
  path: string;
  name: string;
}

/** Typed prop extracted from a component's TypeScript Props interface */
export type ComponentPropField =
  | {
      kind: "enum";
      name: string;
      required: boolean;
      options: string[];
      default?: string;
    }
  | {
      kind: "boolean";
      name: string;
      required: boolean;
      default?: boolean;
    }
  | {
      kind: "string";
      name: string;
      required: boolean;
      default?: string;
    }
  | {
      kind: "number";
      name: string;
      required: boolean;
      default?: number;
    }
  | {
      kind: "unknown";
      name: string;
      required: boolean;
      typeText: string;
    };

export interface ComponentPropSchema {
  /** Relative path to the component file */
  componentPath: string;
  /** Ordered list of props */
  fields: ComponentPropField[];
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
}
