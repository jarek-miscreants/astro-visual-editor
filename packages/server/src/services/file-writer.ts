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
        // CRITICAL: Limit search to the opening tag only — find the first `>`
        // that's not inside a quoted attribute value. Otherwise the regex would
        // match a child element's class attribute and corrupt the file.
        const openTagEnd = findOpenTagEnd(source, tagStart);
        if (openTagEnd === -1) {
          return { success: false, error: `Could not find opening tag end for ${node.tagName}` };
        }
        const openTagSource = source.slice(tagStart, openTagEnd);

        // Find the class attribute within the opening tag only
        const classMatch = openTagSource.match(
          /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/
        );

        if (classMatch) {
          // +1 to skip the leading whitespace we matched
          const attrStart = tagStart + classMatch.index! + 1;
          const fullMatch = classMatch[0].trimStart();
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

        // Validate that the node's source actually looks like an HTML element
        const validatedRange = validateElementRange(source, node);
        if (!validatedRange) {
          return { success: false, error: `Could not validate range for ${node.tagName}` };
        }

        // Remove the element including leading whitespace on the line
        let removeStart = validatedRange.start;
        const lineStart = source.lastIndexOf("\n", removeStart);
        const beforeOnLine = source.slice(lineStart + 1, removeStart);
        if (beforeOnLine.trim() === "") {
          removeStart = lineStart + 1;
        }

        let removeEnd = validatedRange.end;
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

        // Validate the node's source range before extracting/removing
        const validatedRange = validateElementRange(source, node);
        if (!validatedRange) {
          return { success: false, error: `Could not validate range for ${node.tagName}` };
        }

        // Extract the element text
        const elementText = source.slice(validatedRange.start, validatedRange.end);

        // Remove from old position
        let removeStart = validatedRange.start;
        const lineStart = source.lastIndexOf("\n", removeStart);
        const beforeOnLine = source.slice(lineStart + 1, removeStart);
        if (beforeOnLine.trim() === "") {
          removeStart = lineStart + 1;
        }
        let removeEnd = validatedRange.end;
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

/**
 * Validate and correct an element's source range from the AST.
 * The Astro compiler's position.end can be off by one in some cases,
 * pointing to characters of the parent's closing tag. This function
 * verifies the start matches `<{tagName}` and end is `>` or self-closing.
 */
function validateElementRange(
  source: string,
  node: { tagName: string; position: { start: { offset: number }; end: { offset: number } } }
): { start: number; end: number } | null {
  const start = node.position.start.offset;
  let end = node.position.end.offset;

  // Validate start: must be `<{tagName}` (case-insensitive)
  const expectedStart = `<${node.tagName}`;
  const actualStart = source.slice(start, start + expectedStart.length);
  if (actualStart.toLowerCase() !== expectedStart.toLowerCase()) {
    // Try to find the actual element start nearby (within 5 chars)
    for (let offset = -3; offset <= 3; offset++) {
      const probe = source.slice(start + offset, start + offset + expectedStart.length);
      if (probe.toLowerCase() === expectedStart.toLowerCase()) {
        return validateElementRange(source, {
          tagName: node.tagName,
          position: { start: { offset: start + offset }, end: { offset: end } },
        });
      }
    }
    return null;
  }

  // Validate end: should be the character after `>`
  // Check the character at end-1 — should be `>`
  if (source[end - 1] !== ">") {
    // Search forward for `>` (within 10 chars) or backward
    let found = false;
    for (let offset = -2; offset <= 10; offset++) {
      if (source[end + offset - 1] === ">") {
        end = end + offset;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  // For non-self-closing elements, verify the element ends with `</tagName>`
  // (unless it's a void element like <img />)
  const VOID_ELEMENTS = new Set(["img", "input", "br", "hr", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr", "slot"]);
  const isVoid = VOID_ELEMENTS.has(node.tagName.toLowerCase());
  const isSelfClosing = source.slice(end - 2, end) === "/>";

  if (!isVoid && !isSelfClosing) {
    const expectedClose = `</${node.tagName}>`;
    const actualClose = source.slice(end - expectedClose.length, end);
    if (actualClose.toLowerCase() !== expectedClose.toLowerCase()) {
      // Search nearby for the actual closing tag
      const idx = source.indexOf(expectedClose, end - expectedClose.length - 5);
      if (idx === -1 || idx > end + 5) return null;
      end = idx + expectedClose.length;
    }
  }

  return { start, end };
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
