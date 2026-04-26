import { useMemo, useState } from "react";
import { Link as LinkIcon, ExternalLink, FileText, Globe } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";

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

interface PageOption {
  url: string;
  label: string;
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

  const pageOptions: PageOption[] = useMemo(() => {
    const list: PageOption[] = [];
    for (const f of files) {
      if (f.type !== "page") continue;
      const url = pageFileToUrl(f.path);
      if (!url) continue;
      const isTemplate = url.includes("[");
      list.push({ url, label: url, isTemplate });
    }
    // Stable order: home first, then alpha by url
    return list.sort((a, b) => {
      if (a.url === "/" && b.url !== "/") return -1;
      if (b.url === "/" && a.url !== "/") return 1;
      return a.url.localeCompare(b.url);
    });
  }, [files]);

  // Detect mode from the current href: page-shaped if it matches a known page URL.
  const initialMode = useMemo<"url" | "page">(() => {
    if (!href) return "url";
    return pageOptions.some((p) => p.url === href) ? "page" : "url";
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
            value={pageOptions.some((p) => p.url === href) ? href : ""}
            onChange={(e) => {
              const v = e.target.value;
              onAttrChange("href", v === "" ? null : v);
            }}
            className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-blue-500"
          >
            <option value="">— Select a page —</option>
            {pageOptions.map((p) => (
              <option key={p.url} value={p.isTemplate ? "" : p.url} disabled={p.isTemplate}>
                {p.label}
                {p.isTemplate ? " (dynamic — pick in URL mode)" : ""}
              </option>
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
