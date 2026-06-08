import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Box, Type, Image, MousePointer, List, Component, Layers, Package } from "lucide-react";
import type { ASTNode, ComponentRegistryItem } from "@tve/shared";
import { ELEMENT_TEMPLATES, templateToHtml, type TemplateGroup } from "../../lib/element-templates";
import { useEditorStore } from "../../store/editor-store";
import { useComponentRegistryStore } from "../../store/component-registry-store";
import { api } from "../../lib/api-client";
import { buildRegistryComponentHtml } from "../../lib/component-insertion";

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
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const files = useEditorStore((s) => s.files);
  const currentFile = useEditorStore((s) => s.currentFile);
  const ast = useEditorStore((s) => s.ast);
  const registryComponents = useComponentRegistryStore((s) => s.components);
  const registryLoading = useComponentRegistryStore((s) => s.loading);
  const registryError = useComponentRegistryStore((s) => s.lastError);
  const loadRegistry = useComponentRegistryStore((s) => s.load);
  const ensureRegistryEntry = useComponentRegistryStore((s) => s.ensureEntry);

  useEffect(() => {
    void loadRegistry();
  }, [currentFile, loadRegistry]);

  // Project components
  const components = files.filter((f) => f.type === "component");
  const registryByPath = useMemo(() => {
    return new Map(registryComponents.map((component) => [component.componentPath, component]));
  }, [registryComponents]);
  const insertableRegistryComponents = registryComponents.filter((component) => component.insertable);

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

  const query = search.trim().toLowerCase();
  const filteredRegistryComponents = insertableRegistryComponents.filter((component) =>
    matchesRegistryComponent(component, query)
  );
  const groupedRegistryComponents = groupRegistryComponents(filteredRegistryComponents);
  const filteredComponents = components.filter((component) => {
    if (!query) return true;
    const registry = registryByPath.get(component.path);
    const name = componentNameFromPath(component.path);
    return [
      component.path,
      name,
      registry?.label,
      registry?.category,
      registry?.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const filteredExternals = externals.filter(
    (e) => !query || e.name.toLowerCase().includes(query) || e.source.toLowerCase().includes(query)
  );

  async function activateRegistryComponent(component: ComponentRegistryItem) {
    setLoadingPath(component.componentPath);
    try {
      const entry = await ensureRegistryEntry(component.componentPath);
      const html = buildRegistryComponentHtml(entry ?? component);
      onSelect(html, { componentPath: component.componentPath });
      onClose();
    } finally {
      setLoadingPath(null);
    }
  }

  // Flat ordered list of activatable items, in the order they're rendered
  // below. Drives keyboard navigation: each item gets an index, and
  // ArrowDown/Up move `activeIndex` while Enter triggers the item's
  // activate(). Recomputed when the filtered lists change.
  const activators = useMemo<Array<() => void | Promise<void>>>(() => {
    const list: Array<() => void | Promise<void>> = [];
    if (componentsOnly) {
      for (const component of filteredRegistryComponents) {
        list.push(() => activateRegistryComponent(component));
      }
    } else {
      for (const comp of filteredComponents) {
        const registry = registryByPath.get(comp.path);
        if (registry?.insertable) {
          list.push(() => activateRegistryComponent(registry));
        } else {
          const name = componentNameFromPath(comp.path);
          list.push(() => onSelect(`<${name} />`, { componentPath: comp.path }));
        }
      }
    }
    for (const ext of componentsOnly ? [] : filteredExternals) {
      list.push(() => onSelect(buildExternalComponentHtml(ext.name, ast)));
    }
    if (!componentsOnly) {
      for (const group of ELEMENT_TEMPLATES) {
        for (const template of group.templates) {
          if (query && !template.tag.includes(query) && !template.label.toLowerCase().includes(query)) continue;
          list.push(() => onSelect(templateToHtml(template)));
        }
      }
    }
    return list;
  }, [
    filteredComponents,
    filteredExternals,
    filteredRegistryComponents,
    componentsOnly,
    query,
    ast,
    onSelect,
    registryByPath,
  ]);

  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Reset selection whenever the visible list changes (search edits, late
  // external imports landing). Clamp to the new length so we don't hold an
  // out-of-range index.
  useEffect(() => {
    setActiveIndex((i) => (activators.length === 0 ? 0 : Math.min(i, activators.length - 1)));
  }, [activators.length]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlighted button in view as the user arrow-keys past the
  // panel's scroll edge.
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (activators.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % activators.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + activators.length) % activators.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activators[activeIndex]?.();
    }
  }

  // Counter used during render to assign each button its position in the
  // flat `activators` list. Reset every render.
  let renderIndex = 0;
  function nextIndex() {
    return renderIndex++;
  }

  return (
    <div className="w-72 max-h-96 overflow-auto border border-zinc-700 bg-zinc-800 shadow-xl">
      {/* Search */}
      <div className="sticky top-0 z-10 border-b border-zinc-700 bg-zinc-800 p-2">
        <div className="flex items-center gap-1  border border-zinc-600 bg-zinc-900 px-2">
          <Search size={11} className="text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={componentsOnly ? "Search blocks..." : "Search elements..."}
            className="w-full bg-transparent py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            autoFocus
          />
        </div>
      </div>

      <div className="p-1">
        {componentsOnly ? (
          <>
            {registryLoading && insertableRegistryComponents.length === 0 && (
              <div className="px-2 py-4 text-center text-[11px] text-zinc-500">
                Loading blocks...
              </div>
            )}
            {registryError && insertableRegistryComponents.length === 0 && (
              <div className="px-2 py-4 text-center text-[11px] text-red-300">
                {registryError}
              </div>
            )}
            {!registryLoading && !registryError && insertableRegistryComponents.length === 0 && (
              <div className="px-2 py-4 text-center text-[11px] text-zinc-500">
                No insertable blocks found.
              </div>
            )}
            {insertableRegistryComponents.length > 0 && filteredRegistryComponents.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-zinc-500">
                No blocks match "{search}".
              </div>
            )}
            {groupedRegistryComponents.map((group) => (
              <div key={group.category} className="mb-1">
                <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                  <Layers size={10} />
                  {group.category}
                </div>
                {group.items.map((component) => {
                  const idx = nextIndex();
                  const isLoading = loadingPath === component.componentPath;
                  return (
                    <button
                      key={component.componentPath}
                      ref={(el) => { itemRefs.current[idx] = el; }}
                      onClick={() => activateRegistryComponent(component)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      data-active={activeIndex === idx || undefined}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 data-[active]:bg-zinc-700"
                    >
                      <Component size={11} className="shrink-0 text-cyan-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-zinc-200">{component.label}</span>
                        {component.description && (
                          <span className="block truncate text-[10px] text-zinc-500">
                            {component.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[9px] text-zinc-600">
                        {isLoading ? "Adding" : component.fieldCount ? `${component.fieldCount} fields` : component.tagName}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </>
        ) : (
          components.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                <Component size={10} />
                Components
              </div>
              {filteredComponents.map((comp) => {
                const registry = registryByPath.get(comp.path);
                const name = componentNameFromPath(comp.path);
                const idx = nextIndex();
                const isLoading = loadingPath === comp.path;
                return (
                  <button
                    key={comp.path}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    onClick={() => registry?.insertable ? activateRegistryComponent(registry) : onSelect(`<${name} />`, { componentPath: comp.path })}
                    onMouseEnter={() => setActiveIndex(idx)}
                    data-active={activeIndex === idx || undefined}
                    className="flex w-full items-center gap-2 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 data-[active]:bg-zinc-700"
                  >
                    <Component size={11} className="text-cyan-400" />
                    <span className={registry ? "truncate" : "font-mono truncate"}>
                      {registry?.label ?? name}
                    </span>
                    {registry?.category && (
                      <span className="ml-auto shrink-0 text-[9px] text-zinc-600">
                        {isLoading ? "Adding" : registry.category}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )
        )}

        {/* External components imported into this page (e.g. Icon from
            astro-icon). Listed only when present so empty pages don't get a
            stray section. The import already exists in this file, so the
            mutation engine won't need to add one. */}
        {!componentsOnly && filteredExternals.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              <Package size={10} />
              External
            </div>
            {filteredExternals.map((ext) => {
              const idx = nextIndex();
              return (
                <button
                  key={ext.name}
                  ref={(el) => { itemRefs.current[idx] = el; }}
                  onClick={() => onSelect(buildExternalComponentHtml(ext.name, ast))}
                  onMouseEnter={() => setActiveIndex(idx)}
                  data-active={activeIndex === idx || undefined}
                  className="flex w-full items-center gap-2 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 data-[active]:bg-zinc-700"
                  title={`Imported from ${ext.source}`}
                >
                  <Package size={11} className="text-amber-400" />
                  <span className="font-mono">{ext.name}</span>
                  <span className="ml-auto truncate text-[9px] text-zinc-600">{ext.source}</span>
                </button>
              );
            })}
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
              {filtered.map((template) => {
                const idx = nextIndex();
                return (
                  <button
                    key={template.tag + template.label}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    onClick={() => onSelect(templateToHtml(template))}
                    onMouseEnter={() => setActiveIndex(idx)}
                    data-active={activeIndex === idx || undefined}
                    className="flex w-full items-center gap-2  px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 data-[active]:bg-zinc-700"
                  >
                    <span className="font-mono text-blue-400">&lt;{template.tag}&gt;</span>
                    <span className="text-zinc-500">{template.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function componentNameFromPath(path: string): string {
  return path.split("/").pop()?.replace(".astro", "") || path;
}

function matchesRegistryComponent(component: ComponentRegistryItem, query: string): boolean {
  if (!query) return true;
  return [
    component.label,
    component.tagName,
    component.name,
    component.category,
    component.description,
    component.componentPath,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function groupRegistryComponents(components: ComponentRegistryItem[]): Array<{
  category: string;
  items: ComponentRegistryItem[];
}> {
  const groups = new Map<string, ComponentRegistryItem[]>();
  for (const component of components) {
    const category = component.category || "Components";
    const items = groups.get(category) ?? [];
    items.push(component);
    groups.set(category, items);
  }

  return Array.from(groups, ([category, items]) => ({
    category,
    items: [...items].sort((a, b) => a.label.localeCompare(b.label)),
  })).sort((a, b) => a.category.localeCompare(b.category));
}
