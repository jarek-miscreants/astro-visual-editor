import fs from "fs/promises";
import path from "path";

/** A `<slot>` declaration found in a component's source. `name === null`
 *  represents a default (unnamed) slot. Order is the order of appearance in
 *  the source so the tree can render slots in the same order the component
 *  actually consumes them. Duplicates are deduped (a component shouldn't
 *  declare the same slot twice, but we tolerate it). */
export interface ComponentSlotDef {
  name: string | null;
}

const SLOT_TAG_RE = /<slot\b([^>]*)\/?>/g;
const NAME_ATTR_RE = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/;

/** Extract all `<slot>` declarations from a component's source.
 *  Matches both self-closing `<slot />` and `<slot></slot>`. JSX-expression
 *  names (e.g. `<slot name={dynamicName}>`) are skipped — we can't reason
 *  about them statically and surfacing them as a literal slot would mislead
 *  the user. */
export function parseComponentSlots(source: string): ComponentSlotDef[] {
  const seen = new Set<string | null>();
  const out: ComponentSlotDef[] = [];

  let m: RegExpExecArray | null;
  while ((m = SLOT_TAG_RE.exec(source)) !== null) {
    const attrs = m[1] || "";
    const nm = attrs.match(NAME_ATTR_RE);
    let name: string | null = null;
    if (nm) {
      // Static string name
      if (nm[1] !== undefined) name = nm[1];
      else if (nm[2] !== undefined) name = nm[2];
      // Expression — skip; we can't know the value
      else continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name });
  }
  return out;
}

/** Read a component file and return its slot declarations. */
export async function getComponentSlots(
  projectPath: string,
  relPath: string
): Promise<{ componentPath: string; slots: ComponentSlotDef[] }> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  return { componentPath: relPath, slots: parseComponentSlots(source) };
}
