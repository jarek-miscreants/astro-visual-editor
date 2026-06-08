import fs from "fs/promises";
import path from "path";
import type {
  ContentRoot,
  TveContentViewCollection,
  TveContentViewFolder,
  TveContentViewItem,
  TveProjectConfig,
} from "@tve/shared";

const CONFIG_FILE = "tve.config.json";
const CONTENT_ROOTS = new Set<ContentRoot>(["src/content", "src/pages", "content"]);

export async function readTveProjectConfig(projectPath: string): Promise<TveProjectConfig> {
  const configPath = path.join(projectPath, CONFIG_FILE);
  let raw: unknown;

  try {
    raw = JSON.parse(await fs.readFile(configPath, "utf-8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { defaultMode: "dev" };
    }
    throw err;
  }

  const config: Record<string, unknown> = isRecord(raw) ? raw : {};
  const defaultMode = config.defaultMode === "marketer" ? "marketer" : "dev";
  const contentView = normalizeContentView(config.contentView);

  return contentView ? { defaultMode, contentView } : { defaultMode };
}

function normalizeContentView(value: unknown): TveContentViewItem[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items = value
    .map((item) => normalizeContentViewItem(item))
    .filter((item): item is TveContentViewItem => Boolean(item));

  return items.length > 0 ? items : undefined;
}

function normalizeContentViewItem(value: unknown): TveContentViewItem | null {
  if (!isRecord(value)) return null;

  if (typeof value.collection === "string") {
    return normalizeCollectionItem(value);
  }

  const rawItems = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.children)
      ? value.children
      : null;
  if (!rawItems) return null;

  const items = rawItems
    .map((item) => normalizeContentViewItem(item))
    .filter((item): item is TveContentViewItem => Boolean(item));
  const label = readString(value.label ?? value.name ?? value.id);
  if (!label || items.length === 0) return null;

  const folder: TveContentViewFolder = {
    type: "folder",
    label,
    items,
  };
  const id = readString(value.id);
  const description = readString(value.description);
  if (id) folder.id = id;
  if (description) folder.description = description;
  return folder;
}

function normalizeCollectionItem(value: Record<string, unknown>): TveContentViewCollection | null {
  const collection = readString(value.collection);
  if (!collection) return null;

  const item: TveContentViewCollection = {
    type: "collection",
    collection,
  };
  const label = readString(value.label ?? value.name);
  const description = readString(value.description);
  const defaultRoot = readContentRoot(value.defaultRoot ?? value.root);
  if (label) item.label = label;
  if (description) item.description = description;
  if (defaultRoot) item.defaultRoot = defaultRoot;
  return item;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readContentRoot(value: unknown): ContentRoot | undefined {
  if (typeof value !== "string") return undefined;
  return CONTENT_ROOTS.has(value as ContentRoot) ? (value as ContentRoot) : undefined;
}
