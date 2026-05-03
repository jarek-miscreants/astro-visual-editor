import fs from "fs/promises";
import path from "path";
import type { ComponentSlotDef, ComponentSlotSchema } from "@tve/shared";

export type { ComponentSlotDef };

/** Match a `<slot ...>` tag — captures (1) the attribute span and (2) whether
 *  the tag self-closes (`/>`). The tag closes either with `/>` (self-closing)
 *  or `>` (start of a paired tag). Names with JSX expressions are dropped
 *  later because we can't statically resolve them. */
const SLOT_OPEN_RE = /<slot\b([^>]*?)(\/?)>/g;
const NAME_ATTR_RE = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/;

/** Extract all `<slot>` declarations from a component's source.
 *  Matches both self-closing `<slot />` and `<slot></slot>`. JSX-expression
 *  names (e.g. `<slot name={dynamicName}>`) are skipped — we can't reason
 *  about them statically and surfacing them as a literal slot would mislead
 *  the user.
 *
 *  For paired `<slot>...</slot>` tags, any non-whitespace content between the
 *  open and close tags is treated as fallback content. The editor uses this
 *  to render a "shows fallback when empty" hint instead of a bare placeholder. */
export function parseComponentSlots(source: string): ComponentSlotDef[] {
  const seen = new Map<string | null, ComponentSlotDef>();

  let m: RegExpExecArray | null;
  SLOT_OPEN_RE.lastIndex = 0;
  while ((m = SLOT_OPEN_RE.exec(source)) !== null) {
    const attrs = m[1] || "";
    const selfClosing = m[2] === "/";
    const nm = attrs.match(NAME_ATTR_RE);
    let name: string | null = null;
    if (nm) {
      if (nm[1] !== undefined) name = nm[1];
      else if (nm[2] !== undefined) name = nm[2];
      // Expression-named slots are unknowable statically — skip.
      else continue;
    }

    // Detect fallback content. A self-closing tag can't have one. A paired
    // tag does iff there's any non-whitespace between `>` and `</slot>`.
    let hasFallback = false;
    if (!selfClosing) {
      const afterOpen = m.index + m[0].length;
      const closeIdx = source.indexOf("</slot>", afterOpen);
      if (closeIdx !== -1) {
        const inner = source.slice(afterOpen, closeIdx);
        hasFallback = inner.trim().length > 0;
      }
    }

    // Dedupe by name. If a later declaration of the same name has fallback
    // content and the first didn't, upgrade the entry (defensive — components
    // shouldn't declare the same slot twice, but we tolerate it).
    const existing = seen.get(name);
    if (existing) {
      if (hasFallback && !existing.hasFallback) existing.hasFallback = true;
      continue;
    }
    seen.set(name, { name, hasFallback });
  }

  return [...seen.values()];
}

/** Read a component file and return its slot declarations. */
export async function getComponentSlots(
  projectPath: string,
  relPath: string
): Promise<ComponentSlotSchema> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  return { componentPath: relPath, slots: parseComponentSlots(source) };
}
