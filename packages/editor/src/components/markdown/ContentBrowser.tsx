import { useEffect, useMemo, useState } from "react";
import { FileText, Folder, Loader2, Plus, Search } from "lucide-react";
import type { ContentFileInfo, ContentRoot, TveContentViewItem } from "@tve/shared";
import { useContentStore } from "../../store/content-store";
import { useEditorStore } from "../../store/editor-store";
import { ContentFileDialog } from "../dialogs/ContentFileDialog";
import { MarkdownEditor } from "./MarkdownEditor";

type ContentNavNode = ContentNavFolder | ContentNavCollection;

interface ContentNavFolder {
  type: "folder";
  key: string;
  label: string;
  description?: string;
  items: ContentNavNode[];
}

interface ContentNavCollection {
  type: "collection";
  key: string;
  collection: string;
  label: string;
  description?: string;
  defaultRoot?: ContentRoot;
  entries: ContentFileInfo[];
}

export function ContentBrowser() {
  const files = useContentStore((s) => s.files);
  const contentView = useContentStore((s) => s.contentView);
  const currentPath = useContentStore((s) => s.currentPath);
  const current = useContentStore((s) => s.current);
  const dirty = useContentStore((s) => s.dirty);
  const lastError = useContentStore((s) => s.lastError);
  const loadFiles = useContentStore((s) => s.loadFiles);
  const openFile = useContentStore((s) => s.openFile);
  const clearComponentReturn = useEditorStore((s) => s.clearComponentReturn);

  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const navNodes = useMemo(() => buildContentNav(files, contentView), [files, contentView]);
  const collections = useMemo(() => flattenCollections(navNodes), [navNodes]);
  const currentInfo = currentPath ? files.find((file) => file.path === currentPath) : null;

  useEffect(() => {
    if (currentInfo?.collection && currentInfo.collection !== selectedCollection) {
      setSelectedCollection(currentInfo.collection);
      return;
    }
    if (!selectedCollection && collections.length > 0) {
      setSelectedCollection(collections[0].collection);
      return;
    }
    if (selectedCollection && !collections.some((item) => item.collection === selectedCollection)) {
      setSelectedCollection(collections[0]?.collection ?? null);
    }
  }, [collections, currentInfo?.collection, selectedCollection]);

  const activeCollection = collections.find((collection) => collection.collection === selectedCollection);
  const filteredEntries = useMemo(() => {
    const entries = activeCollection?.entries ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entryMatches(entry, needle));
  }, [activeCollection, query]);

  function openEntry(path: string) {
    clearComponentReturn();
    void openFile(path);
  }

  function renderNavNode(node: ContentNavNode, depth = 0) {
    if (node.type === "folder") {
      return (
        <div key={node.key} className={depth === 0 ? "mt-1" : "mt-0.5"}>
          <div
            className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] font-semibold uppercase text-zinc-600"
            style={{ paddingLeft: 8 + depth * 12 }}
            title={node.description}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Folder size={11} className="shrink-0" />
              <span className="min-w-0 truncate">{node.label}</span>
            </span>
            <span className="shrink-0">{countEntries(node)}</span>
          </div>
          {node.items.map((child) => renderNavNode(child, depth + 1))}
        </div>
      );
    }

    const active = node.collection === selectedCollection;
    return (
      <button
        key={node.key}
        onClick={() => setSelectedCollection(node.collection)}
        className={`flex w-full items-center justify-between gap-2 py-1.5 pr-2 text-left text-xs transition-colors ${
          active
            ? "bg-emerald-600/15 text-emerald-200"
            : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={node.description}
      >
        <span className="min-w-0 truncate">{node.label}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">{node.entries.length}</span>
      </button>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-zinc-950 text-zinc-200">
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
          <span className="text-[11px] font-semibold text-zinc-300">Collections</span>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex h-6 w-6 items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-emerald-300"
            title="New content entry"
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {navNodes.map((node) => renderNavNode(node))}

          {collections.length === 0 && (
            <div className="px-2 py-5 text-center text-[11px] text-zinc-500">
              No content files
            </div>
          )}
        </div>
      </aside>

      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-zinc-300">
              {activeCollection?.label ?? "Entries"}
            </div>
            <div className="text-[10px] text-zinc-600">
              {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
            </div>
          </div>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex h-7 items-center gap-1 border border-zinc-800 bg-zinc-950 px-2 text-[11px] font-medium text-emerald-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
          >
            <Plus size={11} />
            New
          </button>
        </div>

        <div className="border-b border-zinc-800 p-2">
          <div className="flex items-center gap-1 border border-zinc-800 bg-zinc-900 px-2">
            <Search size={11} className="text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entries"
              className="h-7 w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {filteredEntries.map((entry) => {
            const active = entry.path === currentPath;
            return (
              <button
                key={entry.path}
                onClick={() => openEntry(entry.path)}
                className={`w-full border-b border-zinc-900 px-3 py-2 text-left transition-colors ${
                  active
                    ? "bg-emerald-600/10 text-zinc-100"
                    : "text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-start gap-2">
                  <FileText
                    size={13}
                    className={`mt-0.5 shrink-0 ${active ? "text-emerald-300" : "text-zinc-600"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs font-medium">
                        {entryTitle(entry)}
                      </span>
                      {dirty && active && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      )}
                    </div>
                    {entry.description && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500">
                        {entry.description}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
                      <span className="truncate">{entry.slug ?? entryBasename(entry.path)}</span>
                      <span>{entry.format}</span>
                      {entry.date && <span>{entry.date}</span>}
                      {entryStatus(entry) && (
                        <span className="text-amber-300">{entryStatus(entry)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {activeCollection && filteredEntries.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-zinc-500">
              No matching entries
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {currentPath ? (
          <MarkdownEditor />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            {lastError ? (
              <span className="text-red-400">{lastError}</span>
            ) : current ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              "Select an entry"
            )}
          </div>
        )}
      </main>

      {showCreateDialog && (
        <ContentFileDialog
          defaultCollection={activeCollection?.collection ?? selectedCollection ?? undefined}
          defaultRoot={activeCollection?.defaultRoot}
          onClose={() => setShowCreateDialog(false)}
        />
      )}
    </div>
  );
}

function buildContentNav(
  files: ContentFileInfo[],
  contentView: TveContentViewItem[] | null
): ContentNavNode[] {
  const grouped = groupFiles(files);
  if (!contentView || contentView.length === 0) {
    return defaultCollectionNodes(grouped);
  }

  const configuredCollections = new Set<string>();
  const nodes = contentView
    .map((item, index) =>
      contentViewItemToNode(item, grouped, configuredCollections, `configured:${index}`)
    )
    .filter((node): node is ContentNavNode => Boolean(node));

  const other = defaultCollectionNodes(grouped).filter(
    (node) => node.type === "collection" && !configuredCollections.has(node.collection)
  );
  if (other.length > 0) {
    nodes.push({
      type: "folder",
      key: "folder:other-collections",
      label: "Other collections",
      items: other,
    });
  }

  return nodes.length > 0 ? nodes : defaultCollectionNodes(grouped);
}

function groupFiles(files: ContentFileInfo[]): Map<string, ContentFileInfo[]> {
  const groups = new Map<string, ContentFileInfo[]>();
  for (const file of files) {
    const list = groups.get(file.collection) ?? [];
    list.push(file);
    groups.set(file.collection, list);
  }
  for (const [collection, entries] of groups) {
    groups.set(collection, [...entries].sort(compareEntries));
  }
  return groups;
}

function defaultCollectionNodes(grouped: Map<string, ContentFileInfo[]>): ContentNavCollection[] {
  return Array.from(grouped, ([collection, entries]) => ({
    type: "collection" as const,
    key: `collection:${collection}`,
    collection,
    label: collection,
    entries,
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function contentViewItemToNode(
  item: TveContentViewItem,
  grouped: Map<string, ContentFileInfo[]>,
  configuredCollections: Set<string>,
  key: string
): ContentNavNode | null {
  if (item.type === "collection") {
    configuredCollections.add(item.collection);
    return {
      type: "collection",
      key: `${key}:collection:${item.collection}`,
      collection: item.collection,
      label: item.label ?? item.collection,
      description: item.description,
      defaultRoot: item.defaultRoot,
      entries: grouped.get(item.collection) ?? [],
    };
  }

  const items = item.items
    .map((child, index) =>
      contentViewItemToNode(child, grouped, configuredCollections, `${key}:folder:${index}`)
    )
    .filter((node): node is ContentNavNode => Boolean(node));
  if (items.length === 0) return null;

  return {
    type: "folder",
    key: `${key}:folder:${item.id ?? item.label}`,
    label: item.label,
    description: item.description,
    items,
  };
}

function flattenCollections(nodes: ContentNavNode[]): ContentNavCollection[] {
  const out: ContentNavCollection[] = [];
  for (const node of nodes) {
    if (node.type === "collection") {
      out.push(node);
    } else {
      out.push(...flattenCollections(node.items));
    }
  }
  return out;
}

function countEntries(node: ContentNavNode): number {
  if (node.type === "collection") return node.entries.length;
  return node.items.reduce((sum, item) => sum + countEntries(item), 0);
}

function compareEntries(a: ContentFileInfo, b: ContentFileInfo): number {
  const dateCompare = (b.date ?? "").localeCompare(a.date ?? "");
  if (dateCompare !== 0) return dateCompare;
  return entryTitle(a).localeCompare(entryTitle(b));
}

function entryMatches(entry: ContentFileInfo, needle: string): boolean {
  return [
    entry.title,
    entry.description,
    entry.slug,
    entry.path,
    entry.status,
    entry.date,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function entryTitle(entry: ContentFileInfo): string {
  return entry.title ?? titleFromSlug(entry.slug ?? entryBasename(entry.path));
}

function entryStatus(entry: ContentFileInfo): string | null {
  if (entry.status) return entry.status;
  if (entry.draft) return "draft";
  return null;
}

function entryBasename(path: string): string {
  return path.split("/").pop()?.replace(/\.(md|mdx)$/i, "") ?? path;
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
