import fs from "fs/promises";
import path from "path";
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
          // Capture group 3 is the JSX expression form `{...}`. Refuse to
          // overwrite — that would clobber a dynamic binding like
          // `class={classes}` and break the component.
          if (classMatch[3] !== undefined) {
            return {
              success: false,
              error: `Cannot edit class on <${node.tagName}> — it uses a JSX expression binding (class={${classMatch[3]}}). Edit the source directly or set the class via the parent component's prop.`,
            };
          }
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

        // Check if parent is self-closing (e.g., <Component /> or <slot />).
        // The Astro parser sometimes reports an end offset that doesn't include
        // the trailing `>` for self-closing tags, so extend the search by a
        // couple of bytes to reliably find `/>`.
        const selfCloseSearchEnd = Math.min(
          parentNode.position.end.offset + 2,
          source.length
        );
        const parentSource = source.slice(
          parentNode.position.start.offset,
          selfCloseSearchEnd
        );
        const selfCloseMatch = parentSource.match(/\/\s*>/);
        const isSelfClosing =
          selfCloseMatch !== null && parentNode.children.length === 0;

        if (isSelfClosing) {
          // Convert self-closing to open/close: <Tag /> → <Tag>\n  child\n</Tag>
          const matchIdx = selfCloseMatch!.index!;
          const matchLen = selfCloseMatch![0].length;
          // Find the space before /> to trim it
          let trimStart = matchIdx;
          while (trimStart > 0 && parentSource[trimStart - 1] === " ") {
            trimStart--;
          }
          const absStart = parentNode.position.start.offset + trimStart;
          const absEnd = parentNode.position.start.offset + matchIdx + matchLen;
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

        // If the inserted HTML references project components (PascalCase tags),
        // add the missing imports to the frontmatter so the page still renders.
        await ensureComponentImports(s, source, filePath, mutation.html);
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

      case "duplicate-element": {
        const node = nodeMap.get(mutation.nodeId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };

        const validatedRange = validateElementRange(source, node);
        if (!validatedRange) {
          return { success: false, error: `Could not validate range for ${node.tagName}` };
        }

        // Extract original element text — preserves JSX expressions verbatim
        const elementText = source.slice(validatedRange.start, validatedRange.end);

        // Detect indentation of the element to use for the duplicate
        const lineStart = source.lastIndexOf("\n", validatedRange.start);
        const indent = source.slice(lineStart + 1, validatedRange.start);
        const beforeOnLine = indent.trim() === "" ? indent : "";

        // Insert the duplicate immediately after the original on a new line
        s.appendRight(validatedRange.end, `\n${beforeOnLine}${elementText}`);
        break;
      }

      case "wrap-element": {
        const node = nodeMap.get(mutation.nodeId);
        if (!node) return { success: false, error: `Node ${mutation.nodeId} not found` };

        const validatedRange = validateElementRange(source, node);
        if (!validatedRange) {
          return { success: false, error: `Could not validate range for ${node.tagName}` };
        }

        // Extract original element text — preserves JSX expressions verbatim
        const elementText = source.slice(validatedRange.start, validatedRange.end);

        const lineStart = source.lastIndexOf("\n", validatedRange.start);
        const indent = source.slice(lineStart + 1, validatedRange.start);
        const isLineStart = indent.trim() === "";
        const baseIndent = isLineStart ? indent : "";
        const childIndent = baseIndent + "  ";

        const wrapperTag = mutation.wrapperTag || "div";
        const classAttr = mutation.wrapperClasses
          ? ` class="${mutation.wrapperClasses}"`
          : "";

        const openTag = `<${wrapperTag}${classAttr}>`;
        const closeTag = `</${wrapperTag}>`;

        let replacement: string;
        if (isLineStart) {
          // Re-indent the inner content one level deeper
          const reindented = elementText.replace(/\n/g, `\n  `);
          replacement = `${openTag}\n${childIndent}${reindented}\n${baseIndent}${closeTag}`;
        } else {
          replacement = `${openTag}${elementText}${closeTag}`;
        }

        s.overwrite(validatedRange.start, validatedRange.end, replacement);
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
 *
 * The Astro compiler's position offsets are unreliable — for some elements
 * (notably <span>, but observed on others too) start.offset is shifted forward
 * by 2-3 chars, landing inside the tag name, and end.offset overshoots past
 * the closing `>`. We can't trust either bound, so we re-locate them by
 * searching the source directly:
 *   1. Find `<tagName` near the reported start (wide search window).
 *   2. Find the matching `</tagName>` by walking forward and tracking
 *      depth of nested same-name tags.
 */
const VOID_ELEMENTS = new Set([
  "img", "input", "br", "hr", "meta", "link", "area", "base",
  "col", "embed", "source", "track", "wbr", "slot",
]);

function validateElementRange(
  source: string,
  node: { tagName: string; position: { start: { offset: number }; end: { offset: number } } }
): { start: number; end: number } | null {
  const tagName = node.tagName;
  const approxStart = node.position.start.offset;
  const approxEnd = node.position.end.offset;
  const startNeedle = `<${tagName}`;
  const startNeedleLower = startNeedle.toLowerCase();

  // Step 1: locate `<tagName` near the reported start. Try the reported
  // offset first, then expand outward up to ±50 chars. The next char after
  // the tag name must be a tag terminator (whitespace, `>`, or `/`).
  let realStart = -1;
  const isTagBoundary = (idx: number) => {
    const c = source[idx];
    return c === " " || c === "\t" || c === "\n" || c === "\r" || c === ">" || c === "/";
  };
  const probeMatch = (offset: number) => {
    if (offset < 0 || offset + startNeedle.length > source.length) return false;
    if (source.slice(offset, offset + startNeedle.length).toLowerCase() !== startNeedleLower) {
      return false;
    }
    return isTagBoundary(offset + startNeedle.length);
  };
  if (probeMatch(approxStart)) {
    realStart = approxStart;
  } else {
    for (let delta = 1; delta <= 50 && realStart === -1; delta++) {
      if (probeMatch(approxStart - delta)) realStart = approxStart - delta;
      else if (probeMatch(approxStart + delta)) realStart = approxStart + delta;
    }
  }
  if (realStart === -1) return null;

  // Step 2: find the end of the opening tag (the `>` that terminates `<tagName ...>`).
  const openTagEnd = findOpenTagEnd(source, realStart);
  if (openTagEnd === -1) return null;

  // Self-closing `<tag ... />` or void element — done.
  const isSelfClosing = source[openTagEnd - 2] === "/";
  const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
  if (isSelfClosing || isVoid) {
    return { start: realStart, end: openTagEnd };
  }

  // Step 3: walk forward tracking nesting of same-name open/close tags
  // until we find the matching `</tagName>`.
  const lowered = source.toLowerCase();
  const closeNeedleLower = `</${tagName}`.toLowerCase();
  const openNeedleLen = startNeedle.length;
  const closeNeedleLen = closeNeedleLower.length;
  let depth = 1;
  let cursor = openTagEnd;
  while (cursor < source.length) {
    const nextOpen = lowered.indexOf(startNeedleLower, cursor);
    const nextClose = lowered.indexOf(closeNeedleLower, cursor);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      if (isTagBoundary(nextOpen + openNeedleLen)) {
        depth++;
      }
      cursor = nextOpen + openNeedleLen;
      continue;
    }
    // Closing tag candidate — must be followed by optional whitespace then `>`
    let closeEnd = nextClose + closeNeedleLen;
    while (closeEnd < source.length && (source[closeEnd] === " " || source[closeEnd] === "\t")) {
      closeEnd++;
    }
    if (source[closeEnd] !== ">") {
      cursor = nextClose + closeNeedleLen;
      continue;
    }
    depth--;
    if (depth === 0) {
      return { start: realStart, end: closeEnd + 1 };
    }
    cursor = closeEnd + 1;
  }
  return null;
}

/**
 * Scan inserted HTML for PascalCase tag references (project components) and
 * append missing imports to the file's frontmatter. Without this, inserting
 * `<MyComponent />` would leave the page broken — the tag would be undefined
 * at render time and Astro would fail to compile.
 */
async function ensureComponentImports(
  s: MagicString,
  source: string,
  filePath: string,
  html: string
): Promise<void> {
  // Collect PascalCase tag names from the inserted HTML
  const tagRegex = /<([A-Z][A-Za-z0-9]*)\b/g;
  const tags = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[1] !== "Fragment") tags.add(m[1]);
  }
  if (tags.size === 0) return;

  // Locate frontmatter `---` ... `---`
  const fmStart = source.indexOf("---");
  if (fmStart !== 0 && source.slice(0, fmStart).trim() !== "") return;
  if (fmStart === -1) return;
  const fmEnd = source.indexOf("---", fmStart + 3);
  if (fmEnd === -1) return;
  const frontmatter = source.slice(fmStart + 3, fmEnd);

  // Find the project root by walking up from filePath until we find src/
  const normalized = filePath.replace(/\\/g, "/");
  const srcIdx = normalized.lastIndexOf("/src/");
  if (srcIdx === -1) return;
  const projectRoot = filePath.slice(0, srcIdx);
  const componentsDir = path.join(projectRoot, "src", "components");
  const sourceDir = path.dirname(filePath);

  const importLines: string[] = [];
  for (const tag of tags) {
    // Already imported? Match `import Tag` or `import { Tag` or `import Tag,`
    const importRe = new RegExp(
      `\\bimport\\s+(?:\\{[^}]*\\b${tag}\\b[^}]*\\}|${tag}\\b)`
    );
    if (importRe.test(frontmatter)) continue;

    // Resolve component file
    const compPath = path.join(componentsDir, `${tag}.astro`);
    try {
      await fs.access(compPath);
    } catch {
      continue; // Not a project component — leave it alone
    }

    let importPath = path.relative(sourceDir, compPath).replace(/\\/g, "/");
    if (!importPath.startsWith(".")) importPath = "./" + importPath;
    importLines.push(`import ${tag} from "${importPath}";`);
  }

  if (importLines.length === 0) return;

  // Insert imports just before the closing `---`, preserving newlines
  const needsLeadingNewline = !frontmatter.endsWith("\n");
  const insertText =
    (needsLeadingNewline ? "\n" : "") + importLines.join("\n") + "\n";
  s.appendLeft(fmEnd, insertText);
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
