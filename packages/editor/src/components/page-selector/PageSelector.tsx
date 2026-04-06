import { useState, useRef, useEffect } from "react";
import { FileText, ChevronDown } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";

export function PageSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const files = useEditorStore((s) => s.files);
  const currentFile = useEditorStore((s) => s.currentFile);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);

  // Group files by type
  const pages = files.filter((f) => f.type === "page");
  const layouts = files.filter((f) => f.type === "layout");
  const components = files.filter((f) => f.type === "component");

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

  const displayName = currentFile
    ? currentFile.replace("src/pages/", "").replace(".astro", "")
    : "Select page";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <FileText size={12} />
        {displayName}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl">
          {pages.length > 0 && (
            <FileGroup
              label="Pages"
              files={pages}
              currentFile={currentFile}
              onSelect={(path) => {
                setCurrentFile(path);
                setOpen(false);
              }}
            />
          )}
          {layouts.length > 0 && (
            <FileGroup
              label="Layouts"
              files={layouts}
              currentFile={currentFile}
              onSelect={(path) => {
                setCurrentFile(path);
                setOpen(false);
              }}
            />
          )}
          {components.length > 0 && (
            <FileGroup
              label="Components"
              files={components}
              currentFile={currentFile}
              onSelect={(path) => {
                setCurrentFile(path);
                setOpen(false);
              }}
            />
          )}
          {files.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">
              No .astro files found
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
}: {
  label: string;
  files: { path: string; type: string }[];
  currentFile: string | null;
  onSelect: (path: string) => void;
}) {
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
              ? "bg-blue-600/20 text-blue-300"
              : "text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          {file.path}
        </button>
      ))}
    </div>
  );
}
