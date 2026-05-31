/**
 * Source-range helpers for Astro element mutations.
 *
 * The Astro compiler's position offsets can be shifted for some nodes. These
 * helpers relocate element bounds from source text before we write anything.
 */

const VOID_ELEMENTS = new Set([
  "img",
  "input",
  "br",
  "hr",
  "meta",
  "link",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
  "slot",
]);

export interface RangeNode {
  tagName: string;
  position: {
    start: { offset: number };
    end: { offset: number };
  };
}

export interface ValidatedElementRange {
  start: number;
  end: number;
}

export function validateElementRange(
  source: string,
  node: RangeNode
): ValidatedElementRange | null {
  const tagName = node.tagName;
  const approxStart = node.position.start.offset;
  const startNeedle = `<${tagName}`;
  const startNeedleLower = startNeedle.toLowerCase();

  let realStart = -1;
  const isTagBoundary = (idx: number) => {
    const c = source[idx];
    return (
      c === " " ||
      c === "\t" ||
      c === "\n" ||
      c === "\r" ||
      c === ">" ||
      c === "/"
    );
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

  const openTagEnd = findOpenTagEnd(source, realStart);
  if (openTagEnd === -1) return null;

  const isSelfClosing = source[openTagEnd - 2] === "/";
  const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
  if (isSelfClosing || isVoid) {
    return { start: realStart, end: openTagEnd };
  }

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

export function findOpenTagEnd(source: string, tagStart: number): number {
  let i = tagStart;
  let inQuote: string | null = null;

  while (i < source.length) {
    const ch = source[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
    i++;
  }
  return -1;
}

export function findCloseTagStart(
  source: string,
  endOffset: number,
  tagName: string
): number {
  const closeTag = `</${tagName}>`;
  const idx = source.lastIndexOf(closeTag, endOffset);
  return idx !== -1 ? idx : endOffset;
}

/**
 * Resolve the INNER content range of a paired element — the offsets strictly
 * *between* the opening tag's `>` and its matching `</tag>`. Used by the
 * `update-raw-content` mutation to overwrite a `<style>`/`<script>` body while
 * leaving the tag, its attributes, and directives (`is:global`, `define:vars`,
 * `lang`, …) byte-for-byte intact.
 *
 * Returns `null` when the element is self-closing/void or the inner range
 * can't be resolved (the caller turns this into a clear error rather than
 * silently corrupting the source).
 */
export function innerContentRange(
  source: string,
  node: RangeNode
): ValidatedElementRange | null {
  // Reuse validateElementRange to relocate the real element bounds from source
  // — the Astro compiler can report off-by-N start offsets, and this also
  // gives us the authoritative end (offset just past `</tag>`).
  const validated = validateElementRange(source, node);
  if (!validated) return null;

  const openTagEnd = findOpenTagEnd(source, validated.start);
  if (openTagEnd === -1) return null;

  // Self-closing (`<tag />`) or void elements have no inner range. For
  // self-closing, validateElementRange returns end === openTagEnd; the `/`
  // sits right before `>`. Refuse — there's nothing between open and close.
  if (source[openTagEnd - 2] === "/") return null;
  if (VOID_ELEMENTS.has(node.tagName.toLowerCase())) return null;

  // The close tag start is the matching `</tag>` located from the validated
  // end (offset just past `</tag>`). validateElementRange already balanced
  // nesting, so this lands on the correct close tag.
  const closeTagStart = findCloseTagStart(source, validated.end, node.tagName);

  // Sanity: inner range must be well-ordered and lie inside the element.
  if (closeTagStart < openTagEnd || closeTagStart > validated.end) return null;

  return { start: openTagEnd, end: closeTagStart };
}

