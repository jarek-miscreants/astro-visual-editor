import { useState, useRef, useEffect } from "react";
import { FileText, ChevronDown, FileType } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useContentStore } from "../../store/content-store";

export function PageSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const files = useEditorStore((s) => s.files);
  const currentFile = useEditorStore((s) => s.currentFile);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);
  const contentFiles = useContentStore((s) => s.files);
  const currentContentPath = useContentStore((s) => s.currentPath);
  const openContentFile = useContentStore((s) => s.openFile);
  const closeContentFile = useContentStore((s) => s.closeFile);

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

  // Close on outside click
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

  function openAstro(path: string) {
    closeContentFile();
    setCurrentFile(path);
    setOpen(false);
  }

  function openContent(path: string) {
    openContentFile(path);
    setOpen(false);
  }

  const displayName = currentContentPath
    ? currentContentPath.replace(/^src\/(content|pages)\//, "").replace(/\.(md|mdx)$/, "")
    : currentFile
    ? currentFile.replace("src/pages/", "").replace(".astro", "")
    : "Select page";

  const isContentOpen = !!currentContentPath;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5  bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        {isContentOpen ? <FileType size={12} /> : <FileText size={12} />}
        {displayName}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72  border border-zinc-700 bg-zinc-800 py-1 shadow-xl max-h-[70vh] overflow-auto">
          {pages.length > 0 && (
            <FileGroup
              label="Pages"
              files={pages}
              currentFile={isContentOpen ? null : currentFile}
              onSelect={openAstro}
            />
          )}
          {layouts.length > 0 && (
            <FileGroup
              label="Layouts"
              files={layouts}
              currentFile={isContentOpen ? null : currentFile}
              onSelect={openAstro}
            />
          )}
          {components.length > 0 && (
            <FileGroup
              label="Components"
              files={components}
              currentFile={isContentOpen ? null : currentFile}
              onSelect={openAstro}
            />
          )}
          {Object.entries(contentByCollection).map(([collection, items]) => (
            <FileGroup
              key={`content-${collection}`}
              label={`Content: ${collection}`}
              files={items.map((f) => ({ path: f.path, type: f.format }))}
              currentFile={currentContentPath}
              onSelect={openContent}
              accent="emerald"
            />
          ))}
          {files.length === 0 && contentFiles.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">
              No editable files found
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FileGroup({
  label,
  files,
  currentFile,
  onSelect,
  accent = "blue",
}: {
  label: string;
  files: { path: string; type: string }[];
  currentFile: string | null;
  onSelect: (path: string) => void;
  accent?: "blue" | "emerald";
}) {
  const activeClass =
    accent === "emerald"
      ? "bg-emerald-600/20 text-emerald-300"
      : "bg-blue-600/20 text-blue-300";
  return (
    <div>
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {files.map((file) => (
        <button
          key={file.path}
          onClick={() => onSelect(file.path)}
          className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
            currentFile === file.path
              ? activeClass
              : "text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          {file.path}
        </button>
      ))}
    </div>
  );
}
