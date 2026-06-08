import { useState, useRef, useEffect } from "react";
import { FileText, ChevronDown, FileType, Box, Plus, Trash2, PanelLeft } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useContentStore } from "../../store/content-store";
import { ContentFileDialog } from "../dialogs/ContentFileDialog";

export function PageSelector() {
  const [createDialogCollection, setCreateDialogCollection] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const files = useEditorStore((s) => s.files);
  const currentFile = useEditorStore((s) => s.currentFile);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);
  const clearComponentReturn = useEditorStore((s) => s.clearComponentReturn);
  const contentFiles = useContentStore((s) => s.files);
  const currentContentPath = useContentStore((s) => s.currentPath);
  const contentBrowserOpen = useContentStore((s) => s.browserOpen);
  const contentDirty = useContentStore((s) => s.dirty);
  const deletingContent = useContentStore((s) => s.deleting);
  const openContentBrowser = useContentStore((s) => s.openBrowser);
  const openContentFile = useContentStore((s) => s.openFile);
  const closeContentFile = useContentStore((s) => s.closeFile);
  const deleteContentFile = useContentStore((s) => s.deleteFile);

  // Group files by type
  const pages = files.filter((f) => f.type === "page");
  const layouts = files.filter((f) => f.type === "layout");
  const components = files.filter((f) => f.type === "component");

  // Group content files by collection
  const contentByCollection = contentFiles.reduce<Record<string, typeof contentFiles>>(
    (acc, f) => {
      (acc[f.collection] ||= []).push(f);
      return acc;
    },
    {}
  );

  // Which category owns the currently-open file?
  const isContentOpen = contentBrowserOpen || !!currentContentPath;
  const isComponentOpen =
    !isContentOpen && !!currentFile?.startsWith("src/components/");
  const isPageOpen = !isContentOpen && !isComponentOpen && !!currentFile;

  function openAstro(path: string) {
    closeContentFile();
    setCurrentFile(path);
  }

  function openContent(path: string) {
    clearComponentReturn();
    openContentFile(path);
  }

  async function deleteContent(path: string) {
    if (deletingContent) return;
    const dirtyWarning =
      path === currentContentPath && contentDirty
        ? "\n\nUnsaved changes in this entry will be lost."
        : "";
    const confirmed = window.confirm(
      `Delete ${path}?\n\nThis removes the content file from disk.${dirtyWarning}`
    );
    if (!confirmed) return;

    try {
      await deleteContentFile(path);
    } catch {
      // The content store records the error for the active markdown editor.
    }
  }

  const astroShortName = (path: string) =>
    path
      .replace(/^src\/(pages|layouts|components)\//, "")
      .replace(/\.astro$/, "");
  const contentShortName = (path: string) =>
    path.replace(/^src\/(content|pages)\//, "").replace(/\.(md|mdx)$/, "");

  return (
    <div className="flex items-center gap-1">
      {/* Pages (+ layouts) */}
      <Dropdown
        icon={<FileText size={12} />}
        label={isPageOpen ? astroShortName(currentFile!) : "Pages"}
        active={isPageOpen}
      >
        {(close) => (
          <>
            {pages.length > 0 && (
              <FileGroup
                label="Pages"
                files={pages}
                currentFile={isPageOpen ? currentFile : null}
                onSelect={(p) => {
                  openAstro(p);
                  close();
                }}
              />
            )}
            {layouts.length > 0 && (
              <FileGroup
                label="Layouts"
                files={layouts}
                currentFile={isPageOpen ? currentFile : null}
                onSelect={(p) => {
                  openAstro(p);
                  close();
                }}
              />
            )}
            {pages.length === 0 && layouts.length === 0 && (
              <EmptyState>No pages found</EmptyState>
            )}
          </>
        )}
      </Dropdown>

      {/* Components */}
      <Dropdown
        icon={<Box size={12} />}
        label={isComponentOpen ? astroShortName(currentFile!) : "Components"}
        active={isComponentOpen}
      >
        {(close) =>
          components.length > 0 ? (
            <FileGroup
              label="Components"
              files={components}
              currentFile={isComponentOpen ? currentFile : null}
              onSelect={(p) => {
                openAstro(p);
                close();
              }}
            />
          ) : (
            <EmptyState>No components found</EmptyState>
          )
        }
      </Dropdown>

      {/* Content collections */}
      <Dropdown
        icon={<FileType size={12} />}
        label={currentContentPath ? contentShortName(currentContentPath) : "Content"}
        active={isContentOpen}
      >
        {(close) => (
          <>
            <button
              onClick={() => {
                clearComponentReturn();
                openContentBrowser();
                close();
              }}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-emerald-300 hover:bg-zinc-700"
            >
              <PanelLeft size={12} />
              Open content library
            </button>
            {Object.entries(contentByCollection).map(([collection, items]) => (
              <FileGroup
                key={`content-${collection}`}
                label={collection}
                files={items.map((f) => ({ path: f.path, type: f.format }))}
                currentFile={currentContentPath}
                onSelect={(p) => {
                  openContent(p);
                  close();
                }}
                accent="emerald"
                onAddNew={() => {
                  setCreateDialogCollection(collection);
                  setShowCreateDialog(true);
                  close();
                }}
                onDelete={deleteContent}
              />
            ))}
            <button
              onClick={() => {
                setCreateDialogCollection(null);
                setShowCreateDialog(true);
                close();
              }}
              className="mt-1 flex w-full items-center gap-1.5 border-t border-zinc-700 px-3 py-2 text-xs text-emerald-400 hover:bg-zinc-700"
            >
              <Plus size={12} />
              New content entry…
            </button>
            {contentFiles.length === 0 && (
              <EmptyState>No content collections</EmptyState>
            )}
          </>
        )}
      </Dropdown>

      {showCreateDialog && (
        <ContentFileDialog
          defaultCollection={createDialogCollection ?? undefined}
          onClose={() => setShowCreateDialog(false)}
        />
      )}
    </div>
  );
}

function Dropdown({
  icon,
  label,
  active,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${
          active
            ? "bg-zinc-700 text-zinc-100"
            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
        }`}
      >
        {icon}
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 border border-zinc-700 bg-zinc-800 py-1 shadow-xl max-h-[70vh] overflow-auto">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-3 text-xs text-zinc-500">{children}</p>;
}

function FileGroup({
  label,
  files,
  currentFile,
  onSelect,
  accent = "blue",
  onAddNew,
  onDelete,
}: {
  label: string;
  files: { path: string; type: string }[];
  currentFile: string | null;
  onSelect: (path: string) => void;
  accent?: "blue" | "emerald";
  onAddNew?: () => void;
  onDelete?: (path: string) => void;
}) {
  const activeClass =
    accent === "emerald"
      ? "bg-emerald-600/20 text-emerald-300"
      : "bg-blue-600/20 text-blue-300";
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        {onAddNew && (
          <button
            onClick={onAddNew}
            className="text-zinc-500 hover:text-emerald-400"
            title="New entry"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      {files.map((file) => {
        const active = currentFile === file.path;
        const rowClass = active ? activeClass : "text-zinc-300 hover:bg-zinc-700";

        if (!onDelete) {
          return (
            <button
              key={file.path}
              onClick={() => onSelect(file.path)}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${rowClass}`}
            >
              {file.path}
            </button>
          );
        }

        return (
          <div
            key={file.path}
            className={`group flex items-center text-xs transition-colors ${rowClass}`}
          >
            <button
              onClick={() => onSelect(file.path)}
              className="min-w-0 flex-1 px-3 py-1.5 text-left"
            >
              <span className="block truncate">{file.path}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(file.path);
              }}
              className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-zinc-500 opacity-0 transition-colors hover:bg-red-950/50 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
              title={`Delete ${file.path}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
