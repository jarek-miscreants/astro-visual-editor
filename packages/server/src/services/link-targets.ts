import fs from "fs/promises";
import path from "path";
import type { LinkTarget } from "@tve/shared";
import { scanProject } from "./project-scanner.js";
import { readContentFile, scanContentFiles, type ContentFileInfo } from "./content-files.js";
import {
  extractCollectionRefs,
  parseDynamicRoutePath,
} from "./collection-routing.js";

function pageFileToUrl(filePath: string): string | null {
  const match = filePath.match(/^src\/pages\/(.*)\.astro$/);
  if (!match) return null;

  let route = match[1];
  if (route === "index") return "/";
  if (route.endsWith("/index")) route = route.slice(0, -"/index".length);
  return `/${route}`;
}

function hasDynamicSegment(filePath: string): boolean {
  return /\/\[[^\]]+\](?:\/|\.astro$)/.test(filePath);
}

function urlTemplateFor(routeFile: string, param: string): string | null {
  const match = routeFile.match(/^src\/pages\/(.+)\.astro$/);
  if (!match) return null;
  const segments = match[1].split("/").slice(0, -1);
  const prefix = segments.length === 0 ? "" : `/${segments.join("/")}`;
  return `${prefix}/{${param}}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^[a-z]+:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/^\/+|\/+$/g, "");
}

function fileSlug(entry: ContentFileInfo): string | null {
  const parts = entry.path.split("/");
  let slugParts: string[];

  if (parts[0] === "src" && parts[1] === "content" && parts[2] === entry.collection) {
    slugParts = parts.slice(3);
  } else if (parts[0] === "content" && parts[1] === entry.collection) {
    slugParts = parts.slice(2);
  } else {
    slugParts = [parts[parts.length - 1]];
  }

  const joined = slugParts.join("/");
  return joined.replace(/\.(md|mdx)$/i, "") || null;
}

function resolveEntrySlug(entry: ContentFileInfo, frontmatter: Record<string, any>): string | null {
  return cleanSlug(frontmatter.slug) ?? fileSlug(entry);
}

function frontmatterTitle(frontmatter: Record<string, any>): string | null {
  for (const key of ["title", "navTitle", "seoTitle", "name", "label"]) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function fillUrlTemplate(template: string, param: string, slug: string): string {
  return template.replace(`{${param}}`, slug);
}

function sortTargets(targets: LinkTarget[]): LinkTarget[] {
  return targets.sort((a, b) => {
    if (a.group !== b.group) {
      if (a.group === "Pages") return -1;
      if (b.group === "Pages") return 1;
      if (a.group === "Templates") return 1;
      if (b.group === "Templates") return -1;
      return a.group.localeCompare(b.group);
    }
    if (a.url === "/" && b.url !== "/") return -1;
    if (b.url === "/" && a.url !== "/") return 1;
    return a.label.localeCompare(b.label) || a.url.localeCompare(b.url);
  });
}

export async function getLinkTargets(projectPath: string): Promise<LinkTarget[]> {
  const [files, contentFiles] = await Promise.all([
    scanProject(projectPath),
    scanContentFiles(projectPath),
  ]);

  const targets: LinkTarget[] = [];

  for (const file of files) {
    if (file.type !== "page") continue;
    if (file.path === "src/pages/tve-preview.astro") continue;
    if (hasDynamicSegment(file.path)) continue;

    const url = pageFileToUrl(file.path);
    if (!url) continue;
    targets.push({
      kind: "page",
      group: "Pages",
      label: url,
      url,
      sourcePath: file.path,
      description: file.path,
    });
  }

  const contentByCollection = new Map<string, ContentFileInfo[]>();
  for (const entry of contentFiles) {
    if (!entry.collection || entry.collection === "root") continue;
    const list = contentByCollection.get(entry.collection) ?? [];
    list.push(entry);
    contentByCollection.set(entry.collection, list);
  }

  for (const file of files) {
    if (file.type !== "page" || !hasDynamicSegment(file.path)) continue;

    const route = parseDynamicRoutePath(file.path);
    if (!route) {
      const url = pageFileToUrl(file.path);
      if (url) {
        targets.push({
          kind: "template",
          group: "Templates",
          label: `${url} (multiple params - use URL)`,
          url,
          disabled: true,
          sourcePath: file.path,
          routeFile: file.path,
          description: file.path,
        });
      }
      continue;
    }

    const source = await fs.readFile(path.join(projectPath, file.path), "utf-8").catch(() => "");
    const collections = [...extractCollectionRefs(source)].filter((collection) =>
      contentByCollection.has(collection)
    );
    const template = urlTemplateFor(file.path, route.param);

    if (!template || collections.length === 0) {
      targets.push({
        kind: "template",
        group: "Templates",
        label: `${pageFileToUrl(file.path) ?? file.path} (unresolved - use URL)`,
        url: pageFileToUrl(file.path) ?? file.path,
        disabled: true,
        sourcePath: file.path,
        routeFile: file.path,
        description: collections.length === 0 ? "No content collection detected" : file.path,
      });
      continue;
    }

    for (const collection of collections) {
      const entries = contentByCollection.get(collection) ?? [];
      const group = `${capitalize(collection)} (${template})`;

      for (const entry of entries) {
        const content = await readContentFile(projectPath, entry.path).catch(() => null);
        if (!content) continue;
        const slug = resolveEntrySlug(entry, content.frontmatter);
        if (!slug) continue;
        if (!route.catchAll && slug.includes("/")) continue;

        const url = fillUrlTemplate(template, route.param, slug);
        targets.push({
          kind: "content",
          group,
          label: frontmatterTitle(content.frontmatter) ?? slug,
          url,
          sourcePath: entry.path,
          routeFile: file.path,
          collection,
          slug,
          description: entry.path,
        });
      }
    }
  }

  return sortTargets(targets);
}
