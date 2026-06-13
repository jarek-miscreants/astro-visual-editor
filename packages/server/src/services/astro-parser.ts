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

  function processNode(
    node: any,
    parent: ASTNode | null,
    renderTarget: "body" | "head" = "body"
  ): ASTNode | null {
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
      const nodeRenderTarget =
        renderTarget === "head" || attributes.slot === "head" ? "head" : "body";

      // Extract text content (only if single text child)
      let textContent: string | null = null;
      let isTextDynamic = false;
      let textExpression: string | null = null;
      if (node.children?.length === 1 && node.children[0].type === "text") {
        textContent = node.children[0].value?.trim() || null;
      } else {
        // Detect text bound to a JSX expression — e.g. `<h3>{feature.title}</h3>`
        // or mixed `Hello {name}`. We must NOT treat the resolved render as
        // editable literal text: overwriting it would clobber the binding (and
        // inside a `.map()`, every rendered instance). Capture the raw `{…}`
        // for read-only display and flag it so the writer refuses update-text.
        // An expression that yields ELEMENTS (`{cond && <a/>}`) is handled by
        // the dynamic-children branch below, not as text — skip those.
        const exprChild = node.children?.find(
          (c: any) => c.type === "expression"
        );
        const exprHasElements = (exprChild?.children ?? []).some(
          (c: any) =>
            c.type === "element" ||
            c.type === "component" ||
            c.type === "custom-element"
        );
        if (exprChild && !exprHasElements) {
          isTextDynamic = true;
          const raw = (exprChild.children ?? [])
            .map((c: any) => (typeof c.value === "string" ? c.value : ""))
            .join("")
            .trim();
          textExpression = `{${raw}}`;
        }
      }

      // For <style>/<script> blocks, also surface the UNTRIMMED inner text so
      // the raw-content editor loads the exact body and undo can restore it
      // byte-for-byte. The compiler emits the whole body as a single text
      // child for these elements.
      let rawTextContent: string | null = null;
      const loweredTag = tagName.toLowerCase();
      if (loweredTag === "style" || loweredTag === "script") {
        if (node.children?.length === 1 && node.children[0].type === "text") {
          rawTextContent = node.children[0].value ?? "";
        } else if (!node.children || node.children.length === 0) {
          // Empty block (`<style></style>`) — distinguish from "not a block".
          rawTextContent = "";
        }
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
        isTextDynamic,
        textExpression,
        rawTextContent,
        attributes,
        children: [],
        position,
        isDynamic: false,
        renderTarget: nodeRenderTarget,
      };

      // Process children
      if (node.children) {
        for (const child of node.children) {
          const childNode = processNode(child, astNode, nodeRenderTarget);
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
        const childNode = processNode(child, parent, renderTarget);
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
      const fragmentRenderTarget =
        renderTarget === "head" || fragmentSlotValue(node) === "head" ? "head" : "body";
      for (const child of node.children) {
        const childNode = processNode(child, parent, fragmentRenderTarget);
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

function fragmentSlotValue(node: any): string | null {
  if (!Array.isArray(node.attributes)) return null;
  const slot = node.attributes.find(
    (attr: any) => attr?.name === "slot" && typeof attr.value === "string"
  );
  return slot?.value ?? null;
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
