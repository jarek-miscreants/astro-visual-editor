import fs from "fs/promises";
import MagicString from "magic-string";
import type { Mutation, ASTNode } from "@tve/shared";
import { parseAstroFileAsync, buildNodeMap } from "./astro-parser.js";

/** Apply a mutation to an .astro source file */
export async function applyMutation(
  filePath: string,
  mutation: Mutation
): Promise<{ success: boolean; error?: string; ast?: ASTNode[] }> {
  try {
    const { ast, source } = await parseAstroFileAsync(filePath);
    const nodeMap = buildNodeMap(ast);
    const s = new MagicString(source);

    switch (mutation.type) {
      case "update-classes": {
        const node = nodeMap.get(mutation.nodeId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };

        const tagStart = node.position.start.offset;
        const tagSource = source.slice(tagStart);

        // Find the class attribute in the tag
        const classMatch = tagSource.match(
          /class\s*=\s*(?:"([^"]*)"|'([^']*)'|{([^}]*)})/
        );

        if (classMatch) {
          const attrStart = tagStart + classMatch.index!;
          const fullMatch = classMatch[0];
          const newAttr = `class="${mutation.classes}"`;
          s.overwrite(attrStart, attrStart + fullMatch.length, newAttr);
        } else {
          // No class attribute exists — insert one after the tag name
          const tagNameEnd = tagStart + node.tagName.length + 1; // +1 for <
          s.appendRight(tagNameEnd, ` class="${mutation.classes}"`);
        }
        break;
      }

      case "update-text": {
        const node = nodeMap.get(mutation.nodeId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };

        // Find the text content between the opening and closing tags
        const openTagEnd = findOpenTagEnd(source, node.position.start.offset);
        const closeTagStart = findCloseTagStart(
          source,
          node.position.end.offset,
          node.tagName
        );

        if (openTagEnd !== -1 && closeTagStart !== -1) {
          s.overwrite(openTagEnd, closeTagStart, mutation.text);
        }
        break;
      }

      case "update-attribute": {
        const node = nodeMap.get(mutation.nodeId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };

        const tagStart = node.position.start.offset;
        const openTagEnd = findOpenTagEnd(source, tagStart);
        const tagSource = source.slice(tagStart, openTagEnd);

        const attrRegex = new RegExp(
          `${mutation.attr}\\s*=\\s*(?:"[^"]*"|'[^']*')`
        );
        const attrMatch = tagSource.match(attrRegex);

        if (mutation.value === null) {
          // Remove attribute
          if (attrMatch) {
            const attrAbsStart = tagStart + attrMatch.index!;
            // Also remove leading whitespace
            let removeStart = attrAbsStart;
            while (removeStart > tagStart && source[removeStart - 1] === " ") {
              removeStart--;
            }
            s.remove(removeStart, attrAbsStart + attrMatch[0].length);
          }
        } else if (attrMatch) {
          // Update existing attribute
          const attrAbsStart = tagStart + attrMatch.index!;
          s.overwrite(
            attrAbsStart,
            attrAbsStart + attrMatch[0].length,
            `${mutation.attr}="${mutation.value}"`
          );
        } else {
          // Insert new attribute
          const tagNameEnd = tagStart + node.tagName.length + 1;
          s.appendRight(tagNameEnd, ` ${mutation.attr}="${mutation.value}"`);
        }
        break;
      }

      case "add-element": {
        const parentNode = nodeMap.get(mutation.parentNodeId);
        if (!parentNode)
          return { success: false, error: `Parent node ${mutation.parentNodeId} not found` };

        // Detect indentation of parent
        const parentLine = source.lastIndexOf("\n", parentNode.position.start.offset);
        const parentIndent = source.slice(
          parentLine + 1,
          parentNode.position.start.offset
        );
        const childIndent = parentIndent + "  ";

        // Check if parent is self-closing (e.g., <Component /> or <slot />)
        // Search for /> within the element's source range
        const parentSource = source.slice(
          parentNode.position.start.offset,
          parentNode.position.end.offset
        );
        // Find the last occurrence of /> in the element source
        const selfCloseIdx = parentSource.lastIndexOf("/>");
        const isSelfClosing = selfCloseIdx !== -1 && parentNode.children.length === 0;

        if (isSelfClosing) {
          // Convert self-closing to open/close: <Tag /> → <Tag>\n  child\n</Tag>
          // Find the space before /> to trim it
          let trimStart = selfCloseIdx;
          while (trimStart > 0 && parentSource[trimStart - 1] === " ") {
            trimStart--;
          }
          const absStart = parentNode.position.start.offset + trimStart;
          const absEnd = parentNode.position.start.offset + selfCloseIdx + 2; // +2 for />
          const replacement = `>\n${childIndent}${mutation.html}\n${parentIndent}</${parentNode.tagName}>`;
          s.overwrite(absStart, absEnd, replacement);
        } else if (
          mutation.position >= parentNode.children.length ||
          parentNode.children.length === 0
        ) {
          // Insert at end of parent (before closing tag)
          const closeTagStart = findCloseTagStart(
            source,
            parentNode.position.end.offset,
            parentNode.tagName
          );
          const insertHtml = `\n${childIndent}${mutation.html}\n${parentIndent}`;
          s.appendLeft(closeTagStart, insertHtml);
        } else {
          // Insert before the child at the given position
          const targetChild = parentNode.children[mutation.position];
          const insertHtml = `${mutation.html}\n${childIndent}`;
          s.appendLeft(targetChild.position.start.offset, insertHtml);
        }
        break;
      }

      case "remove-element": {
        const node = nodeMap.get(mutation.nodeId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };

        // Remove the element including leading whitespace on the line
        let removeStart = node.position.start.offset;
        const lineStart = source.lastIndexOf("\n", removeStart);
        const beforeOnLine = source.slice(lineStart + 1, removeStart);
        if (beforeOnLine.trim() === "") {
          removeStart = lineStart + 1;
        }

        let removeEnd = node.position.end.offset;
        // Also remove trailing newline if present
        if (source[removeEnd] === "\n") {
          removeEnd++;
        }

        s.remove(removeStart, removeEnd);
        break;
      }

      case "move-element": {
        const node = nodeMap.get(mutation.nodeId);
        const newParent = nodeMap.get(mutation.newParentId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };
        if (!newParent) return { success: false, error: `Target parent ${mutation.newParentId} not found` };

        // Extract the element text
        const elementText = source.slice(
          node.position.start.offset,
          node.position.end.offset
        );

        // Remove from old position
        let removeStart = node.position.start.offset;
        const lineStart = source.lastIndexOf("\n", removeStart);
        const beforeOnLine = source.slice(lineStart + 1, removeStart);
        if (beforeOnLine.trim() === "") {
          removeStart = lineStart + 1;
        }
        let removeEnd = node.position.end.offset;
        if (source[removeEnd] === "\n") removeEnd++;
        s.remove(removeStart, removeEnd);

        // Insert at new position
        const parentLine = source.lastIndexOf("\n", newParent.position.start.offset);
        const parentIndent = source.slice(
          parentLine + 1,
          newParent.position.start.offset
        );
        const childIndent = parentIndent + "  ";

        if (
          mutation.newPosition >= newParent.children.length ||
          newParent.children.length === 0
        ) {
          const closeTagStart = findCloseTagStart(
            source,
            newParent.position.end.offset,
            newParent.tagName
          );
          s.appendLeft(closeTagStart, `\n${childIndent}${elementText}`);
        } else {
          const targetChild = newParent.children[mutation.newPosition];
          s.appendLeft(
            targetChild.position.start.offset,
            `${elementText}\n${childIndent}`
          );
        }
        break;
      }

      default:
        return { success: false, error: `Unknown mutation type` };
    }

    // Write the modified source back
    await fs.writeFile(filePath, s.toString(), "utf-8");

    // Re-parse to return updated AST
    const { ast: newAst } = await parseAstroFileAsync(filePath);
    return { success: true, ast: newAst };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Find the end of the opening tag (position of '>') */
function findOpenTagEnd(source: string, tagStart: number): number {
  let i = tagStart;
  let inQuote: string | null = null;

  while (i < source.length) {
    const ch = source[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else {
      if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ">") {
        return i + 1;
      }
    }
    i++;
  }
  return -1;
}

/** Find the start of the closing tag (position of '</tagName>') */
function findCloseTagStart(
  source: string,
  endOffset: number,
  tagName: string
): number {
  // Search backwards from the end offset
  const closeTag = `</${tagName}>`;
  const idx = source.lastIndexOf(closeTag, endOffset);
  return idx !== -1 ? idx : endOffset;
}
