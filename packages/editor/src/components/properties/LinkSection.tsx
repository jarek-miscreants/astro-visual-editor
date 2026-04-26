import { useMemo, useState } from "react";
import { Link as LinkIcon, ExternalLink, FileText, Globe } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useContentStore } from "../../store/content-store";

interface Props {
  /** Current href value (empty string if not set) */
  href: string;
  /** Current target attribute, if any */
  target?: string;
  /** Current rel attribute, if any */
  rel?: string;
  /** Emit one attribute change at a time. value=null deletes the attribute. */
  onAttrChange: (attr: string, value: string | null) => void;
  /** Section label override — e.g. "Button link" for components */
  label?: string;
  /** Hide the "Open in new tab" checkbox (for components that don't accept a target prop) */
  hideNewTab?: boolean;
}

const NEW_TAB_REL = "noopener noreferrer";

/**
 * Convert an Astro source path to its served URL.
 *   src/pages/index.astro            → /
 *   src/pages/about.astro            → /about
 *   src/pages/blog/index.astro       → /blog
 *   src/pages/blog/[slug].astro      → /blog/[slug]    (template, can't link directly)
 */
function pageFileToUrl(filePath: string): string | null {
  const m = filePath.match(/^src\/pages\/(.*)\.astro$/);
  if (!m) return null;
  let route = m[1];
  // Strip trailing /index
  if (route === "index") return "/";
  if (route.endsWith("/index")) route = route.slice(0, -"/index".length);
  return "/" + route;
}

/**
 * Match a single-param dynamic route file. Returns the collection name (the
 * directory before the [param] segment) and the route prefix.
 *   src/pages/blog/[slug].astro     → { collection: "blog", prefix: "/blog" }
 *   src/pages/[slug].astro          → { collection: null, prefix: "" } (root-level dynamic)
 *   src/pages/blog/[...slug].astro  → null  (catch-all, skipped)
 */
function parseDynamicRoute(
  filePath: string
): { collection: string | null; prefix: string } | null {
  const m = filePath.match(/^src\/pages\/(.*)\/\[([^\]]+)\]\.astro$/);
  if (m) {
    if (m[2].startsWith("...")) return null; // catch-all
    const prefix = "/" + m[1];
    const collection = m[1].split("/").pop() || null;
    return { collection, prefix };
  }
  // Root-level [slug].astro — no collection inference possible
  const root = filePath.match(/^src\/pages\/\[([^\]]+)\]\.astro$/);
  if (root && !root[1].startsWith("...")) {
    return { collection: null, prefix: "" };
  }
  return null;
}

/** Extract slug from a content file path: src/content/blog/foo.md → "foo" */
function contentPathToSlug(filePath: string, collection: string): string | null {
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = filePath.match(new RegExp(`^src\\/content\\/${escaped}\\/(.+)\\.(md|mdx)$`));
  return m ? m[1] : null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface PageOption {
  url: string;
  label: string;
  /** Group label for optgroup. "Pages" for static, collection name for content entries. */
  group: string;
  isTemplate: boolean;
}

/**
 * Marketer-friendly link editor. Edits href directly and offers a single
 * "Open in new tab" toggle that pairs target=_blank with a safe rel value.
 * Used for raw `<a>` elements and as a building block for component props
 * that expose href + target.
 */
export function LinkSection({
  href,
  target,
  rel,
  onAttrChange,
  label = "Link",
  hideNewTab = false,
}: Props) {
  const files = useEditorStore((s) => s.files);
  const contentFiles = useContentStore((s) => s.files);

  const pageOptions: PageOption[] = useMemo(() => {
    const list: PageOption[] = [];

    // Static pages — non-dynamic .astro files
    for (const f of files) {
      if (f.type !== "page") continue;
      const url = pageFileToUrl(f.path);
      if (!url) continue;
      if (url.includes("[")) continue; // dynamic templates handled below
      list.push({ url, label: url, group: "Pages", isTemplate: false });
    }

    // Dynamic routes paired with content collections — generate one URL per
    // collection entry. Heuristic: pages/X/[slug].astro pairs with the X
    // collection. Custom slugs in frontmatter aren't followed (filename slug
    // is used). Catch-all routes are skipped.
    for (const f of files) {
      if (f.type !== "page") continue;
      const route = parseDynamicRoute(f.path);
      if (!route) {
        // Surface the dynamic file as a disabled "template" entry so the user
        // sees it exists but knows they need URL mode.
        const url = pageFileToUrl(f.path);
        if (url && url.includes("[")) {
          list.push({ url, label: `${url} (dynamic — use URL mode)`, group: "Templates", isTemplate: true });
        }
        continue;
      }
      if (!route.collection) {
        // Root-level [slug].astro — can't infer collection
        list.push({
          url: f.path,
          label: `/${f.path} (custom routing — use URL mode)`,
          group: "Templates",
          isTemplate: true,
        });
        continue;
      }
      // Pair with content collection of the same name
      const entries = contentFiles.filter((c) => c.collection === route.collection);
      if (entries.length === 0) {
        // Dynamic route exists but no entries yet — show as template
        const url = pageFileToUrl(f.path);
        if (url) {
          list.push({
            url,
            label: `${url} (no entries yet)`,
            group: "Templates",
            isTemplate: true,
          });
        }
        continue;
      }
      for (const entry of entries) {
        const slug = contentPathToSlug(entry.path, route.collection);
        if (!slug) continue;
        const url = `${route.prefix}/${slug}`;
        list.push({
          url,
          label: url,
          group: capitalize(route.collection),
          isTemplate: false,
        });
      }
    }

    return list;
  }, [files, contentFiles]);

  // Group options by section for the dropdown's optgroups. Pages always first.
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, PageOption[]>();
    for (const opt of pageOptions) {
      const arr = groups.get(opt.group) || [];
      arr.push(opt);
      groups.set(opt.group, arr);
    }
    // Sort within each group: home first, then alpha
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        if (a.url === "/" && b.url !== "/") return -1;
        if (b.url === "/" && a.url !== "/") return 1;
        return a.url.localeCompare(b.url);
      });
    }
    // Fixed group order: Pages, then alpha-sorted collections, then Templates last
    const fixed = ["Pages"];
    const collectionGroups = [...groups.keys()]
      .filter((g) => g !== "Pages" && g !== "Templates")
      .sort();
    const order = [...fixed, ...collectionGroups, "Templates"];
    return order
      .filter((g) => groups.has(g))
      .map((g) => ({ group: g, options: groups.get(g)! }));
  }, [pageOptions]);

  // Detect mode from the current href: page-shaped if it matches a known
  // (non-template) page URL.
  const initialMode = useMemo<"url" | "page">(() => {
    if (!href) return "url";
    return pageOptions.some((p) => !p.isTemplate && p.url === href) ? "page" : "url";
  }, [href, pageOptions]);

  const [mode, setMode] = useState<"url" | "page">(initialMode);

  const isNewTab = target === "_blank";
  // We only manage the rel value when we own it (i.e. when we set it for new
  // tab safety). If the user has a custom rel, we leave it alone on toggle-off.
  const ourRel = rel === NEW_TAB_REL || rel === "noopener" || rel === "noreferrer";

  function handleNewTabToggle(checked: boolean) {
    if (checked) {
      onAttrChange("target", "_blank");
      if (!rel) onAttrChange("rel", NEW_TAB_REL);
    } else {
      onAttrChange("target", null);
      if (ourRel) onAttrChange("rel", null);
    }
  }

  const isExternalUrl = href.startsWith("http://") || href.startsWith("https://");

  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          <LinkIcon size={11} className="text-blue-400" />
          {label}
        </div>
        {pageOptions.length > 0 && (
          <div className="inline-flex items-center gap-0.5 rounded border border-zinc-800 bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setMode("url")}
              className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium transition-colors ${
                mode === "url"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Globe size={9} />
              URL
            </button>
            <button
              type="button"
              onClick={() => setMode("page")}
              className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium transition-colors ${
                mode === "page"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <FileText size={9} />
              Page
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {mode === "url" ? (
          <div className="flex gap-1">
            <input
              type="text"
              key={href}
              defaultValue={href}
              placeholder="https://… or /path or #anchor"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== href) onAttrChange("href", v === "" ? null : v);
              }}
              className="min-w-0 flex-1 border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-blue-500 placeholder:text-zinc-600"
            />
            {isExternalUrl && (
              <button
                type="button"
                onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
                title="Open link in new tab"
                className="flex h-[28px] w-[28px] shrink-0 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        ) : (
          <select
            value={
              pageOptions.some((p) => !p.isTemplate && p.url === href) ? href : ""
            }
            onChange={(e) => {
              const v = e.target.value;
              onAttrChange("href", v === "" ? null : v);
            }}
            className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-blue-500"
          >
            <option value="">— Select a page —</option>
            {groupedOptions.map(({ group, options }) => (
              <optgroup key={group} label={group}>
                {options.map((p) => (
                  <option
                    key={p.url + p.label}
                    value={p.isTemplate ? "" : p.url}
                    disabled={p.isTemplate}
                  >
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {!hideNewTab && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300 select-none">
            <input
              type="checkbox"
              checked={isNewTab}
              onChange={(e) => handleNewTabToggle(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            Open in new tab
          </label>
        )}
        {!href && mode === "url" && (
          <p className="text-[10px] text-zinc-600">
            Tip: use <span className="font-mono text-zinc-500">/page</span> for
            internal links, <span className="font-mono text-zinc-500">#section</span>{" "}
            for in-page anchors, or a full URL for external sites.
          </p>
        )}
      </div>
    </div>
  );
}
