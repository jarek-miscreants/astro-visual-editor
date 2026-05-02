/** A named or default import parsed out of an .astro file's frontmatter.
 *  Drives the editor's AddElementPanel "External components" section so
 *  package-imported components (Icon from astro-icon, etc.) are visible
 *  alongside project components. */
export interface FrontmatterImport {
  /** The local binding name as used in the markup (e.g. "Icon"). */
  name: string;
  /** The module specifier (e.g. "astro-icon/components", "../components/Foo.astro"). */
  source: string;
  /** True when the import was `import Foo from "..."` (default), false for `import { Foo }`. */
  isDefault: boolean;
  /** True when `source` doesn't look like a relative or alias path — i.e.
   *  resolves to a node_modules package or virtual module rather than a
   *  project file. */
  isExternal: boolean;
}

const FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---/;

/** Extract import statements from an .astro file's frontmatter. Returns []
 *  when there's no frontmatter or no imports. Matches the common shapes:
 *    import Foo from "./Foo.astro";
 *    import { Foo, Bar as Baz } from "package";
 *    import Foo, { Bar } from "package";
 *  Type-only imports (`import type`) are skipped — they don't produce a
 *  runtime binding usable as a tag. */
export function parseFrontmatterImports(source: string): FrontmatterImport[] {
  const fmMatch = source.match(FRONTMATTER_RE);
  if (!fmMatch) return [];
  const fm = fmMatch[1];

  const imports: FrontmatterImport[] = [];

  // Walk line-by-line so multi-line imports are reassembled. Cheap parser:
  // strip line/block comments first, then collapse `import type {...}` whole
  // statements so the value-import regex below can't pick them up. Type-only
  // bindings have no runtime tag and would lead to broken markup if surfaced.
  const cleaned = fm
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\bimport\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, "");

  // Match: import [defaultName,] [{ named, list }] from "source";
  const importRe =
    /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?|\{([^}]*)\})\s+from\s+['"]([^'"]+)['"]/g;

  let m: RegExpExecArray | null;
  while ((m = importRe.exec(cleaned)) !== null) {
    const defaultName = m[1];
    const namedAfterDefault = m[2];
    const namedOnly = m[3];
    const moduleSource = m[4];
    const isExternal = !isLocalSpecifier(moduleSource);

    if (defaultName) {
      imports.push({ name: defaultName, source: moduleSource, isDefault: true, isExternal });
    }
    const namedList = namedAfterDefault ?? namedOnly;
    if (namedList) {
      for (const part of namedList.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        // Handle `Foo as Bar` — the local binding is the alias.
        const aliasMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        const local = aliasMatch ? aliasMatch[2] : trimmed.match(/^[A-Za-z_$][\w$]*$/)?.[0];
        if (!local) continue;
        imports.push({ name: local, source: moduleSource, isDefault: false, isExternal });
      }
    }
  }

  return imports;
}

/** A specifier is "local" when it points at the project tree or a
 *  configured alias rather than node_modules. Astro's `astro:*` virtual
 *  modules are also non-external for our purposes (they're not user
 *  components — caller filters them out separately). */
function isLocalSpecifier(spec: string): boolean {
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) return true;
  if (spec.startsWith("~/") || spec.startsWith("@/")) return true; // common aliases
  return false;
}
