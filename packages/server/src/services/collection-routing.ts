import fs from "fs/promises";
import path from "path";
import { scanProject } from "./project-scanner.js";
import { scanContentFiles } from "./content-files.js";

/** Per-collection routing status. Drives whether the editor offers an
 *  "open in real preview" toggle, an embedded-only view, or an orphan banner. */
export type CollectionRouteStatus =
  | {
      kind: "routed";
      collection: string;
      /** The `.astro` page file that resolves this collection's entries. */
      routeFile: string;
      /** Param name from the dynamic segment, e.g. "slug" for [slug] or [...slug]. */
      param: string;
      isCatchAll: boolean;
      /** URL template with `{<param>}` placeholder. null when the route has
       *  multiple unresolvable params (e.g. /[lang]/blog/[slug]). */
      urlTemplate: string | null;
      /** Other pages that also reference the collection (cards on home, etc). */
      embeddedIn: string[];
    }
  | {
      kind: "embedded";
      collection: string;
      pages: string[];
    }
  | {
      kind: "orphan";
      collection: string;
    };

const GET_COLLECTION_RE = /\bgetCollection\s*\(\s*['"`]([\w-]+)['"`]/g;

/** Find every `getCollection('X')` reference in a source string and return
 *  the set of collection names. */
function extractCollectionRefs(source: string): Set<string> {
  const refs = new Set<string>();
  for (const m of source.matchAll(GET_COLLECTION_RE)) {
    refs.add(m[1]);
  }
  return refs;
}

/** Match a dynamic Astro page file. Single-param only; multi-param routes
 *  are recorded as routed without a URL template. Returns null for static
 *  pages.
 *    src/pages/blog/[slug].astro       → { dirParts: ["blog"], param: "slug" }
 *    src/pages/[slug].astro            → { dirParts: [], param: "slug" }
 *    src/pages/blog/[...slug].astro    → { dirParts: ["blog"], param: "slug", catchAll: true }
 *    src/pages/[lang]/blog/[slug].astro → null (multi-param)
 */
export function parseDynamicRoutePath(filePath: string): {
  dirParts: string[];
  param: string;
  catchAll: boolean;
} | null {
  const m = filePath.match(/^src\/pages\/(.+)\.astro$/);
  if (!m) return null;
  const route = m[1];
  const segments = route.split("/");

  let dynamicCount = 0;
  let param = "";
  let catchAll = false;
  let dynamicIdx = -1;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dyn = seg.match(/^\[(\.\.\.)?([\w-]+)\]$/);
    if (dyn) {
      dynamicCount++;
      param = dyn[2];
      catchAll = !!dyn[1];
      dynamicIdx = i;
    }
  }

  // Static page or multi-param — caller decides what to do
  if (dynamicCount === 0) return null;
  if (dynamicCount > 1) return null;
  // Last segment must be the dynamic one for clean URL templating
  if (dynamicIdx !== segments.length - 1) return null;

  const dirParts = segments.slice(0, -1);
  return { dirParts, param, catchAll };
}

/** Build URL template like "/blog/{slug}" from a dynamic route file. */
function urlTemplateFor(routeFile: string, param: string): string {
  const m = routeFile.match(/^src\/pages\/(.+)\.astro$/);
  if (!m) return "";
  const segments = m[1].split("/").slice(0, -1);
  const prefix = segments.length === 0 ? "" : "/" + segments.join("/");
  return `${prefix}/{${param}}`;
}

/** Resolve a slug against a routed collection's URL template. Catch-all
 *  routes accept slashes in the slug; single-param routes do not. Returns
 *  null when the collection isn't routed or has no template. */
export function resolveEntryUrl(
  status: CollectionRouteStatus,
  slug: string
): string | null {
  if (status.kind !== "routed" || !status.urlTemplate) return null;
  return status.urlTemplate.replace(`{${status.param}}`, slug);
}

/** Scan the project and classify each collection as routed / embedded / orphan.
 *  Reads every .astro file once; cheap on small projects, would benefit from
 *  caching + watcher invalidation if it ever appears in a hot path. */
export async function getCollectionRouting(
  projectPath: string
): Promise<Map<string, CollectionRouteStatus>> {
  const [astroFiles, contentFiles] = await Promise.all([
    scanProject(projectPath),
    scanContentFiles(projectPath),
  ]);

  // Discover every collection that has at least one entry on disk. Collections
  // declared in content.config.ts but never instantiated would be missed —
  // accept that for now; the goal is per-entry preview routing.
  const collections = new Set<string>();
  for (const f of contentFiles) {
    if (f.collection && f.collection !== "root") collections.add(f.collection);
  }

  // Read every .astro file's source once. Collect:
  //   1. Dynamic routes that resolve a collection (via getCollection inside).
  //   2. Static pages / layouts / components that reference a collection.
  type DynamicRoute = {
    routeFile: string;
    param: string;
    catchAll: boolean;
    refs: Set<string>;
  };
  const dynamicRoutes: DynamicRoute[] = [];
  const embeddedRefs = new Map<string, Set<string>>(); // collection → set of files that reference it

  for (const file of astroFiles) {
    let source: string;
    try {
      source = await fs.readFile(path.join(projectPath, file.path), "utf-8");
    } catch {
      continue;
    }
    const refs = extractCollectionRefs(source);
    if (refs.size === 0 && file.type !== "page") continue;

    const dyn = file.type === "page" ? parseDynamicRoutePath(file.path) : null;

    if (dyn) {
      dynamicRoutes.push({ routeFile: file.path, param: dyn.param, catchAll: dyn.catchAll, refs });
    } else {
      // Non-dynamic file referencing a collection — embedded usage
      for (const collection of refs) {
        const set = embeddedRefs.get(collection) ?? new Set<string>();
        set.add(file.path);
        embeddedRefs.set(collection, set);
      }
    }
  }

  const result = new Map<string, CollectionRouteStatus>();

  // First pass: routed collections. A collection is routed when at least one
  // dynamic route's source calls getCollection('<name>'). If a collection
  // has multiple matching routes (rare), prefer the first one — the editor
  // can refine later.
  for (const dyn of dynamicRoutes) {
    for (const collection of dyn.refs) {
      if (result.has(collection)) continue; // first wins
      const urlTemplate = urlTemplateFor(dyn.routeFile, dyn.param);
      const embedded = [...(embeddedRefs.get(collection) ?? [])];
      result.set(collection, {
        kind: "routed",
        collection,
        routeFile: dyn.routeFile,
        param: dyn.param,
        isCatchAll: dyn.catchAll,
        urlTemplate: urlTemplate || null,
        embeddedIn: embedded,
      });
    }
  }

  // Second pass: collections that aren't routed but appear in embedded refs
  for (const [collection, pages] of embeddedRefs) {
    if (result.has(collection)) continue;
    result.set(collection, { kind: "embedded", collection, pages: [...pages] });
  }

  // Third pass: orphans — collections with content files but no references anywhere
  for (const collection of collections) {
    if (!result.has(collection)) {
      result.set(collection, { kind: "orphan", collection });
    }
  }

  return result;
}
