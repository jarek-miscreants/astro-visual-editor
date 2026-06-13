import type {
  ASTNode,
  ComponentRegistryEntry,
  ComponentRegistryItem,
  Mutation,
  RepeaterFieldSpec,
  RepeaterLayout,
} from "@tve/shared";

type RegistryInsertable = Pick<
  ComponentRegistryItem,
  "componentPath" | "tagName"
> &
  Partial<Pick<ComponentRegistryEntry, "defaultProps" | "defaultChildren">>;

export interface ResolvedInsertionTarget {
  parentNodeId: string;
  position: number;
}

export function buildRegistryComponentHtml(component: RegistryInsertable): string {
  const attrs = Object.entries(component.defaultProps ?? {})
    .flatMap(([key, value]) => {
      if (value === null || value === undefined) return [];
      return [formatAstroAttribute(key, value)];
    })
    .join(" ");
  const attrText = attrs ? ` ${attrs}` : "";

  if (component.defaultChildren && component.defaultChildren.trim()) {
    return `<${component.tagName}${attrText}>${component.defaultChildren}</${component.tagName}>`;
  }

  return `<${component.tagName}${attrText} />`;
}

export function makeAddElementMutation(
  ast: ASTNode[] | null,
  selectedNodeId: string | null,
  html: string,
  componentPath?: string
): Mutation | null {
  const target = resolveInsertionTarget(ast, selectedNodeId);
  if (!target) return null;

  return {
    type: "add-element",
    parentNodeId: target.parentNodeId,
    position: target.position,
    html,
    componentPath,
  };
}

export function makeInsertRepeaterMutation(
  ast: ASTNode[] | null,
  selectedNodeId: string | null,
  config: {
    arrayName: string;
    itemVar: string;
    layout: RepeaterLayout;
    fields: RepeaterFieldSpec[];
  }
): Mutation | null {
  const target = resolveInsertionTarget(ast, selectedNodeId);
  if (!target) return null;
  return {
    type: "insert-repeater",
    parentNodeId: target.parentNodeId,
    position: target.position,
    ...config,
  };
}

export function resolveInsertionTarget(
  ast: ASTNode[] | null,
  selectedNodeId: string | null
): ResolvedInsertionTarget | null {
  if (!ast || ast.length === 0) return null;

  if (selectedNodeId) {
    const selected = findNode(ast, selectedNodeId);
    if (selected && canContainBlock(selected)) {
      return {
        parentNodeId: selected.nodeId,
        position: selected.children.length,
      };
    }

    const parent = findParent(ast, selectedNodeId);
    if (parent) {
      return {
        parentNodeId: parent.parent.nodeId,
        position: parent.index + 1,
      };
    }
  }

  const defaultNode =
    findFirstNode(ast, (node) => node.tagName.toLowerCase() === "main") ??
    findFirstNode(ast, isLayoutLikeComponent) ??
    findFirstNode(ast, canContainBlock);

  if (!defaultNode) return null;

  return {
    parentNodeId: defaultNode.nodeId,
    position: defaultNode.children.length,
  };
}

function formatAstroAttribute(
  key: string,
  value: string | number | boolean
): string {
  if (typeof value === "string") {
    return `${key}="${escapeAttrValue(value)}"`;
  }

  return `${key}={${String(value)}}`;
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function canContainBlock(node: ASTNode): boolean {
  const tag = node.tagName.toLowerCase();
  if (tag === "slot") return true;
  if (isLayoutLikeComponent(node)) return true;

  return BLOCK_CONTAINERS.has(tag);
}

function isLayoutLikeComponent(node: ASTNode): boolean {
  return (
    node.isComponent &&
    /(?:layout|page|wrapper|shell)$/i.test(node.tagName)
  );
}

const BLOCK_CONTAINERS = new Set([
  "main",
  "section",
  "article",
  "aside",
  "div",
  "header",
  "footer",
  "nav",
  "ul",
  "ol",
  "li",
  "form",
  "figure",
  "figcaption",
  "blockquote",
  "details",
  "summary",
]);

function findNode(nodes: ASTNode[], nodeId: string): ASTNode | null {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node;
    const found = findNode(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

function findFirstNode(
  nodes: ASTNode[],
  predicate: (node: ASTNode) => boolean
): ASTNode | null {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const found = findFirstNode(node.children, predicate);
    if (found) return found;
  }
  return null;
}

function findParent(
  nodes: ASTNode[],
  nodeId: string
): { parent: ASTNode; index: number } | null {
  for (const node of nodes) {
    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].nodeId === nodeId) {
        return { parent: node, index: i };
      }
    }
    const found = findParent(node.children, nodeId);
    if (found) return found;
  }
  return null;
}
