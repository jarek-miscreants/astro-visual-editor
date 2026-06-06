import fs from "fs/promises";
import path from "path";
import MagicString from "magic-string";
import type {
  ASTNode,
  SeoFieldState,
  SeoPageData,
  SeoPageResponse,
  SeoWarning,
} from "@tve/shared";
import { parseAstroFileAsync } from "./astro-parser.js";
import * as sourceRange from "./source-range.js";

type SeoKey = keyof SeoPageData;

interface SeoComponentConfig {
  tagName: string;
  path?: string;
  insertion?: {
    mode: "layout-slot" | "before-layout" | "inside-layout-first-child";
    layout?: string;
    slot?: string;
  };
  fields: Partial<Record<SeoKey, string>>;
}

interface TveSeoConfig {
  preferredAdapter?: "component" | "layout-props" | "head-tags";
  component?: SeoComponentConfig;
}

const SEO_KEYS: SeoKey[] = [
  "title",
  "description",
  "canonical",
  "ogTitle",
  "ogDescription",
  "ogImage",
  "twitterImage",
  "noindex",
];

const DEFAULT_FIELDS: Record<SeoKey, string> = {
  title: "title",
  description: "description",
  canonical: "canonical",
  ogTitle: "ogTitle",
  ogDescription: "ogDescription",
  ogImage: "image",
  twitterImage: "twitterImage",
  noindex: "noindex",
};

function emptyFields(): Record<SeoKey, SeoFieldState> {
  return Object.fromEntries(
    SEO_KEYS.map((key) => [
      key,
      {
        value: key === "noindex" ? false : "",
        writable: false,
        reason: "No editable SEO source found.",
      },
    ])
  ) as Record<SeoKey, SeoFieldState>;
}

export async function analyzeSeoPage(
  projectPath: string,
  relPath: string
): Promise<SeoPageResponse> {
  const fullPath = path.join(projectPath, relPath);
  const config = await readSeoConfig(projectPath);
  const { ast } = await parseAstroFileAsync(fullPath);
  const componentConfig = normalizeComponentConfig(config?.component);
  const tagName = componentConfig.tagName;
  const seoNode = findFirstNode(ast, (node) => node.tagName === tagName);
  const fields = emptyFields();
  const warnings: SeoWarning[] = [];

  if (seoNode) {
    for (const key of SEO_KEYS) {
      const prop = componentConfig.fields[key] ?? DEFAULT_FIELDS[key];
      const raw = seoNode.attributes[prop];
      const expression = typeof raw === "string" && raw.startsWith("{") && raw.endsWith("}");
      fields[key] = {
        value: key === "noindex" ? boolValue(raw) : raw ?? "",
        writable: !expression,
        reason: expression ? "This value is bound to an Astro expression." : undefined,
        source: { kind: "component-prop", nodeId: seoNode.nodeId, prop },
      };
    }
  }

  addSeoWarnings(fields, warnings, !seoNode);
  const canInsert = !seoNode && canInsertSeo(ast, componentConfig);
  if (!seoNode && !canInsert) {
    warnings.push({
      code: "seo-missing",
      message: componentConfig.insertion
        ? "SEO component is missing and the configured insertion target was not found."
        : "SEO component is missing. Configure an insertion mode before TVE can add it.",
      severity: "info",
    });
  }

  return {
    path: relPath,
    editable: !!seoNode,
    adapter: seoNode ? "component" : "none",
    found: !!seoNode,
    canInsert,
    data: fieldsToData(fields),
    fields,
    warnings,
  };
}

export async function updateSeoPage(
  projectPath: string,
  relPath: string,
  input: Partial<SeoPageData>
): Promise<SeoPageResponse> {
  const fullPath = path.join(projectPath, relPath);
  const config = await readSeoConfig(projectPath);
  const componentConfig = normalizeComponentConfig(config?.component);
  const { ast, source } = await parseAstroFileAsync(fullPath);
  const seoNode = findFirstNode(ast, (node) => node.tagName === componentConfig.tagName);
  if (!seoNode) throw new Error("SEO component not found on this page");

  const s = new MagicString(source);
  for (const key of SEO_KEYS) {
    if (!(key in input)) continue;
    const prop = componentConfig.fields[key] ?? DEFAULT_FIELDS[key];
    const current = seoNode.attributes[prop];
    if (typeof current === "string" && current.startsWith("{") && current.endsWith("}")) {
      continue;
    }
    const value = input[key];
    const next =
      key === "noindex"
        ? value === true
          ? "true"
          : null
        : typeof value === "string"
          ? value.trim() === ""
            ? null
            : value
          : null;
    upsertAttribute(s, source, seoNode, prop, next);
  }

  await fs.writeFile(fullPath, s.toString(), "utf-8");
  return analyzeSeoPage(projectPath, relPath);
}

export async function addSeoToPage(
  projectPath: string,
  relPath: string,
  input: Partial<SeoPageData>
): Promise<SeoPageResponse> {
  const fullPath = path.join(projectPath, relPath);
  const config = await readSeoConfig(projectPath);
  const componentConfig = normalizeComponentConfig(config?.component);
  if (!componentConfig.path || !componentConfig.insertion) {
    throw new Error("SEO component path and insertion mode must be configured");
  }

  const { ast, source } = await parseAstroFileAsync(fullPath);
  if (findFirstNode(ast, (node) => node.tagName === componentConfig.tagName)) {
    return analyzeSeoPage(projectPath, relPath);
  }

  const s = new MagicString(source);
  ensureImport(s, source, fullPath, projectPath, componentConfig);
  insertSeoComponent(s, source, ast, componentConfig, input);
  await fs.writeFile(fullPath, s.toString(), "utf-8");
  return analyzeSeoPage(projectPath, relPath);
}

async function readSeoConfig(projectPath: string): Promise<TveSeoConfig | null> {
  const configPath = path.join(projectPath, "tve.config.json");
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8"));
    return parsed?.seo && typeof parsed.seo === "object" ? parsed.seo : null;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function normalizeComponentConfig(input: SeoComponentConfig | undefined): SeoComponentConfig {
  return {
    tagName: input?.tagName ?? "SEO",
    path: input?.path,
    insertion: input?.insertion,
    fields: { ...DEFAULT_FIELDS, ...(input?.fields ?? {}) },
  };
}

function findFirstNode(nodes: ASTNode[], predicate: (node: ASTNode) => boolean): ASTNode | null {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const child = findFirstNode(node.children, predicate);
    if (child) return child;
  }
  return null;
}

function canInsertSeo(ast: ASTNode[], config: SeoComponentConfig): boolean {
  if (!config.path || !config.insertion) return false;
  if (config.insertion.mode === "layout-slot" || config.insertion.mode === "inside-layout-first-child") {
    const layout = config.insertion.layout;
    return !!layout && !!findFirstNode(ast, (node) => node.tagName === layout);
  }
  if (config.insertion.mode === "before-layout") {
    const layout = config.insertion.layout;
    return !layout || !!findFirstNode(ast, (node) => node.tagName === layout);
  }
  return false;
}

function boolValue(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (value === "" || value === "true") return true;
  return false;
}

function fieldsToData(fields: Record<SeoKey, SeoFieldState>): Partial<SeoPageData> {
  const out: Partial<SeoPageData> = {};
  for (const key of SEO_KEYS) {
    (out as any)[key] = fields[key].value ?? (key === "noindex" ? false : "");
  }
  return out;
}

function addSeoWarnings(fields: Record<SeoKey, SeoFieldState>, warnings: SeoWarning[], missing: boolean) {
  if (missing) return;
  if (!fields.title.value) {
    warnings.push({ code: "missing-title", message: "Missing page title.", severity: "warning" });
  }
  if (!fields.description.value) {
    warnings.push({ code: "missing-description", message: "Missing meta description.", severity: "warning" });
  }
  const title = String(fields.title.value ?? "");
  const description = String(fields.description.value ?? "");
  if (title.length > 60) {
    warnings.push({ code: "title-long", message: "Title is longer than 60 characters.", severity: "info" });
  }
  if (description.length > 160) {
    warnings.push({ code: "description-long", message: "Description is longer than 160 characters.", severity: "info" });
  }
  if (fields.noindex.value === true) {
    warnings.push({ code: "noindex", message: "This page is marked noindex.", severity: "warning" });
  }
}

function upsertAttribute(
  s: MagicString,
  source: string,
  node: ASTNode,
  attr: string,
  value: string | null
) {
  const range = sourceRange.validateElementRange(source, node);
  if (!range) throw new Error(`Could not validate range for <${node.tagName}>`);
  const openTagEnd = sourceRange.findOpenTagEnd(source, range.start);
  const tagSource = source.slice(range.start, openTagEnd);
  const attrMatch = tagSource.match(new RegExp(`\\s${escapeRegExp(attr)}\\s*=\\s*(?:"[^"]*"|'[^']*')`));

  if (value === null) {
    if (!attrMatch) return;
    const start = range.start + attrMatch.index!;
    s.remove(start, start + attrMatch[0].length);
    return;
  }

  const attrText = ` ${attr}="${escapeAttr(value)}"`;
  if (attrMatch) {
    const start = range.start + attrMatch.index!;
    s.overwrite(start, start + attrMatch[0].length, attrText);
  } else {
    const tagNameEnd = range.start + node.tagName.length + 1;
    s.appendRight(tagNameEnd, attrText);
  }
}

function ensureImport(
  s: MagicString,
  source: string,
  pageFullPath: string,
  projectPath: string,
  config: SeoComponentConfig
) {
  if (!config.path) return;
  const fm = frontmatterRange(source);
  const frontmatter = fm ? source.slice(fm.start, fm.end) : "";
  const importRe = new RegExp(`\\bimport\\s+${escapeRegExp(config.tagName)}\\b`);
  if (importRe.test(frontmatter)) return;

  const componentPath = path.join(projectPath, config.path);
  let importPath = path.relative(path.dirname(pageFullPath), componentPath).replace(/\\/g, "/");
  if (!importPath.startsWith(".")) importPath = "./" + importPath;
  const line = `import ${config.tagName} from "${importPath}";`;

  if (fm) {
    s.appendLeft(fm.end, `${frontmatter.endsWith("\n") ? "" : "\n"}${line}\n`);
  } else {
    s.prepend(`---\n${line}\n---\n\n`);
  }
}

function insertSeoComponent(
  s: MagicString,
  source: string,
  ast: ASTNode[],
  config: SeoComponentConfig,
  input: Partial<SeoPageData>
) {
  const insertion = config.insertion;
  if (!insertion) throw new Error("SEO insertion is not configured");
  const attrs = seoAttrs(config, input);
  const tag = `<${config.tagName}${attrs} />`;

  if (insertion.mode === "layout-slot") {
    const layout = findFirstNode(ast, (node) => node.tagName === insertion.layout);
    if (!layout) throw new Error(`Could not find <${insertion.layout}> insertion target`);
    const range = sourceRange.validateElementRange(source, layout);
    if (!range) throw new Error(`Could not validate range for <${layout.tagName}>`);
    const openTagEnd = sourceRange.findOpenTagEnd(source, range.start);
    const baseIndent = indentAt(source, range.start);
    const childIndent = baseIndent + "  ";
    const innerIndent = childIndent + "  ";
    const slotName = insertion.slot ?? "head";
    s.appendRight(
      openTagEnd,
      `\n${childIndent}<Fragment slot="${slotName}">\n${innerIndent}${tag}\n${childIndent}</Fragment>`
    );
    return;
  }

  if (insertion.mode === "inside-layout-first-child") {
    const layout = findFirstNode(ast, (node) => node.tagName === insertion.layout);
    if (!layout) throw new Error(`Could not find <${insertion.layout}> insertion target`);
    const range = sourceRange.validateElementRange(source, layout);
    if (!range) throw new Error(`Could not validate range for <${layout.tagName}>`);
    const openTagEnd = sourceRange.findOpenTagEnd(source, range.start);
    s.appendRight(openTagEnd, `\n${indentAt(source, range.start)}  ${tag}`);
    return;
  }

  if (insertion.mode === "before-layout") {
    const layout = insertion.layout
      ? findFirstNode(ast, (node) => node.tagName === insertion.layout)
      : ast[0];
    if (!layout) throw new Error("Could not find insertion target");
    const range = sourceRange.validateElementRange(source, layout);
    if (!range) throw new Error(`Could not validate range for <${layout.tagName}>`);
    s.appendLeft(range.start, `${tag}\n`);
  }
}

function seoAttrs(config: SeoComponentConfig, input: Partial<SeoPageData>): string {
  const parts: string[] = [];
  for (const key of SEO_KEYS) {
    const prop = config.fields[key] ?? DEFAULT_FIELDS[key];
    const value = input[key];
    if (key === "noindex") {
      if (value === true) parts.push(`${prop}="true"`);
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      parts.push(`${prop}="${escapeAttr(value)}"`);
    }
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

function frontmatterRange(source: string): { start: number; end: number } | null {
  const match = source.match(/^---\r?\n/);
  if (!match) return null;
  const start = match[0].length;
  const close = source.indexOf("---", start);
  if (close === -1) return null;
  return { start, end: close };
}

function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset);
  return source.slice(lineStart + 1, offset).match(/^\s*/)?.[0] ?? "";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
