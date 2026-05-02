import { useEffect, useState } from "react";
import { Search, Box, Type, Image, MousePointer, List, Component, Layers, Package } from "lucide-react";
import type { ASTNode } from "@tve/shared";
import { ELEMENT_TEMPLATES, templateToHtml, type TemplateGroup } from "../../lib/element-templates";
import { useEditorStore } from "../../store/editor-store";
import { api } from "../../lib/api-client";

interface AddElementPanelProps {
  onSelect: (html: string, options?: { componentPath?: string }) => void;
  onClose: () => void;
  /** If true, only show project components — hide raw HTML element templates.
   *  Used in marketer mode where the authoring surface is pre-built blocks. */
  componentsOnly?: boolean;
}

interface ExternalImport {
  name: string;
  source: string;
}

/** Build the HTML for an inserted external component. We can't introspect
 *  Props for package components (they live in node_modules and we'd have
 *  to walk types), so a bare `<Tag />` often crashes Astro at render —
 *  e.g. `<Icon />` from astro-icon throws "Icon requires a name prop".
 *  Mitigation: copy attributes from the first existing instance of the
 *  same tag on the open page. Excludes context-specific attributes
 *  (`slot`, `class`) so the inserted element doesn't accidentally land
 *  in someone else's slot or carry styling that doesn't fit. */
function buildExternalComponentHtml(tagName: string, ast: ASTNode[] | null): string {
  const sample = ast ? findFirstNodeByTag(ast, tagName) : null;
  if (!sample) return `<${tagName} />`;
  const skip = new Set(["slot", "class", "className"]);
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(sample.attributes)) {
    if (skip.has(key)) continue;
    // Astro expression bindings come back as `{expr}`; we can't safely
    // re-emit those for a fresh element so just drop them.
    if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) continue;
    attrs.push(`${key}="${escapeAttrValue(value)}"`);
  }
  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
  return `<${tagName}${attrStr} />`;
}

function findFirstNodeByTag(nodes: ASTNode[], tagName: string): ASTNode | null {
  for (const n of nodes) {
    if (n.tagName === tagName) return n;
    const found = findFirstNodeByTag(n.children, tagName);
    if (found) return found;
  }
  return null;
}

function escapeAttrValue(v: string): string {
  return v.replace(/"/g, "&quot;");
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Structure: <Box size={11} />,
  Text: <Type size={11} />,
  Media: <Image size={11} />,
  Interactive: <MousePointer size={11} />,
  List: <List size={11} />,
  Astro: <Layers size={11} />,
};

export function AddElementPanel({ onSelect, onClose, componentsOnly = false }: AddElementPanelProps) {
  const [search, setSearch] = useState("");
  const files = useEditorStore((s) => s.files);
  const currentFile = useEditorStore((s) => s.currentFile);
  const ast = useEditorStore((s) => s.ast);

  // Project components
  const components = files.filter((f) => f.type === "component");

  // External components: parsed from the open file's frontmatter, filtered to
  // PascalCase names imported from non-relative sources. Fetched once per
  // file open so the panel can offer Icon, Image, etc. that the project
  // scanner wouldn't surface. Skips lowercase names (utility helpers like
  // getCollection) since they aren't valid component tags.
  const [externals, setExternals] = useState<ExternalImport[]>([]);
  useEffect(() => {
    if (!currentFile) {
      setExternals([]);
      return;
    }
    let cancelled = false;
    api
      .getFileImports(currentFile)
      .then(({ imports }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const out: ExternalImport[] = [];
        for (const imp of imports) {
          if (!imp.isExternal) continue;
          if (!/^[A-Z]/.test(imp.name)) continue; // not a component-shaped tag
          // astro:* virtual modules expose helpers, not components — skip.
          if (imp.source.startsWith("astro:")) continue;
          if (seen.has(imp.name)) continue;
          seen.add(imp.name);
          out.push({ name: imp.name, source: imp.source });
        }
        setExternals(out);
      })
      .catch(() => {
        if (!cancelled) setExternals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFile]);

  const query = search.toLowerCase();
  const filteredComponents = components.filter(
    (c) => !query || c.path.toLowerCase().includes(query)
  );
  const filteredExternals = externals.filter(
    (e) => !query || e.name.toLowerCase().includes(query) || e.source.toLowerCase().includes(query)
  );

  return (
    <div className="w-64 max-h-96 overflow-auto  border border-zinc-700 bg-zinc-800 shadow-xl">
      {/* Search */}
      <div className="sticky top-0 z-10 border-b border-zinc-700 bg-zinc-800 p-2">
        <div className="flex items-center gap-1  border border-zinc-600 bg-zinc-900 px-2">
          <Search size={11} className="text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search elements..."
            className="w-full bg-transparent py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            autoFocus
          />
        </div>
      </div>

      <div className="p-1">
        {/* Project components */}
        {components.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
              <Component size={10} />
              Components
            </div>
            {filteredComponents.map((comp) => {
              const name = comp.path.split("/").pop()?.replace(".astro", "") || comp.path;
              return (
                <button
                  key={comp.path}
                  onClick={() => onSelect(`<${name} />`, { componentPath: comp.path })}
                  className="flex w-full items-center gap-2  px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  <Component size={11} className="text-cyan-400" />
                  <span className="font-mono">{name}</span>
                </button>
              );
            })}
          </div>
        )}

        {componentsOnly && components.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-zinc-500">
            No components found in this project.
          </div>
        )}
        {componentsOnly && components.length > 0 && filteredComponents.length === 0 && (
          <div className="px-2 py-3 text-center text-[11px] text-zinc-500">
            No components match "{search}".
          </div>
        )}

        {/* External components imported into this page (e.g. Icon from
            astro-icon). Listed only when present so empty pages don't get a
            stray section. The import already exists in this file, so the
            mutation engine won't need to add one. */}
        {filteredExternals.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              <Package size={10} />
              External
            </div>
            {filteredExternals.map((ext) => (
              <button
                key={ext.name}
                onClick={() => onSelect(buildExternalComponentHtml(ext.name, ast))}
                className="flex w-full items-center gap-2 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                title={`Imported from ${ext.source}`}
              >
                <Package size={11} className="text-amber-400" />
                <span className="font-mono">{ext.name}</span>
                <span className="ml-auto truncate text-[9px] text-zinc-600">{ext.source}</span>
              </button>
            ))}
          </div>
        )}

        {/* HTML element groups — hidden in componentsOnly mode */}
        {!componentsOnly && ELEMENT_TEMPLATES.map((group) => {
          const filtered = group.templates.filter(
            (t) => !query || t.tag.includes(query) || t.label.toLowerCase().includes(query)
          );
          if (filtered.length === 0) return null;

          return (
            <div key={group.label} className="mb-1">
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {GROUP_ICONS[group.label] || <Box size={10} />}
                {group.label}
              </div>
              {filtered.map((template) => (
                <button
                  key={template.tag + template.label}
                  onClick={() => onSelect(templateToHtml(template))}
                  className="flex w-full items-center gap-2  px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  <span className="font-mono text-blue-400">&lt;{template.tag}&gt;</span>
                  <span className="text-zinc-500">{template.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
