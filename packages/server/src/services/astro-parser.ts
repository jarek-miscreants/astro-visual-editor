import { parse } from "@astrojs/compiler";
import fs from "fs/promises";
import crypto from "crypto";
import type { ASTNode, SourcePosition } from "@tve/shared";

/** Parse an .astro file into our editor AST with source positions */
export async function parseAstroFileAsync(
  filePath: string
): Promise<{ ast: ASTNode[]; source: string }> {
  const source = await fs.readFile(filePath, "utf-8");
  const nodes = await parseAstroSourceAsync(source, filePath);
  return { ast: nodes, source };
}

/** Parse an Astro source string into editor AST nodes */
async function parseAstroSourceAsync(
  source: string,
  filePath: string
): Promise<ASTNode[]> {
  const fileHash = crypto
    .createHash("md5")
    .update(filePath)
    .digest("hex")
    .slice(0, 8);

  const result = await parse(source, { position: true });
  const rootNodes: ASTNode[] = [];
  let nodeIndex = 0;

  function processNode(node: any, parent: ASTNode | null): ASTNode | null {
    // Skip frontmatter, comments, doctype
    if (
      node.type === "frontmatter" ||
      node.type === "comment" ||
      node.type === "doctype"
    ) {
      return null;
    }

    // Handle element nodes
    if (
      node.type === "element" ||
      node.type === "component" ||
      node.type === "custom-element"
    ) {
      const nodeId = `tve-${fileHash}-${nodeIndex++}`;
      const tagName: string = node.name || "unknown";
      const isComponent = /^[A-Z]/.test(tagName);

      // Extract class attribute
      let classes = "";
      let classExpression: string | null = null;
      const attributes: Record<string, string> = {};

      if (node.attributes) {
        for (const attr of node.attributes) {
          if (
            attr.kind === "quoted" ||
            attr.kind === "empty" ||
            attr.kind === "template-literal"
          ) {
            if (attr.name === "class") {
              classes = attr.value || "";
            } else {
              attributes[attr.name] = attr.value || "";
            }
          } else if (attr.kind === "expression") {
            if (attr.name === "class") {
              // class={expr} — preserve so we can show it read-only and refuse
              // to overwrite the binding with a string literal
              classExpression = `{${attr.value || "..."}}`;
            } else {
              attributes[attr.name] = `{${attr.value || "..."}}`;
            }
          }
        }
      }

      // Extract text content (only if single text child)
      let textContent: string | null = null;
      if (node.children?.length === 1 && node.children[0].type === "text") {
        textContent = node.children[0].value?.trim() || null;
      }

      const position: SourcePosition = {
        start: {
          offset: node.position?.start?.offset ?? 0,
          line: node.position?.start?.line ?? 0,
          column: node.position?.start?.column ?? 0,
        },
        end: {
          offset: node.position?.end?.offset ?? 0,
          line: node.position?.end?.line ?? 0,
          column: node.position?.end?.column ?? 0,
        },
      };

      const astNode: ASTNode = {
        nodeId,
        tagName,
        isComponent,
        classes,
        classExpression,
        textContent,
        attributes,
        children: [],
        position,
        isDynamic: false,
      };

      // Process children
      if (node.children) {
        for (const child of node.children) {
          const childNode = processNode(child, astNode);
          if (childNode) {
            astNode.children.push(childNode);
          }
        }
      }

      return astNode;
    }

    // Handle expression nodes that contain elements
    if (node.type === "expression" && node.children) {
      for (const child of node.children) {
        const childNode = processNode(child, parent);
        if (childNode) {
          childNode.isDynamic = true;
          if (parent) {
            parent.children.push(childNode);
          } else {
            rootNodes.push(childNode);
          }
        }
      }
    }

    // Handle fragment / root
    if ((node.type === "root" || node.type === "fragment") && node.children) {
      for (const child of node.children) {
        const childNode = processNode(child, parent);
        if (childNode) {
          if (parent) {
            parent.children.push(childNode);
          } else {
            rootNodes.push(childNode);
          }
        }
      }
    }

    return null;
  }

  processNode(result.ast, null);
  return rootNodes;
}

/** Build a flat map of nodeId -> ASTNode */
export function buildNodeMap(nodes: ASTNode[]): Map<string, ASTNode> {
  const map = new Map<string, ASTNode>();

  function walk(node: ASTNode) {
    map.set(node.nodeId, node);
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return map;
}
