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

/** Project info returned by the API */
export interface ProjectInfo {
  path: string;
  name: string;
  hasAstro: boolean;
  hasTailwind: boolean;
}
