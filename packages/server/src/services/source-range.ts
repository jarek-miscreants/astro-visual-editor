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

