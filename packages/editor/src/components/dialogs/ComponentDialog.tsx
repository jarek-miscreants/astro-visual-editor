import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { api } from "../../lib/api-client";
import { useEditorStore } from "../../store/editor-store";

interface ComponentDialogProps {
  mode: "create" | "extract";
  /** For extract mode — the nodeId to extract */
  nodeId?: string;
  onClose: () => void;
}

export function ComponentDialog({ mode, nodeId, onClose }: ComponentDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadFiles = useEditorStore((s) => s.loadFiles);
  const currentFile = useEditorStore((s) => s.currentFile);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);
  const updateAst = useEditorStore((s) => s.updateAst);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name) {
      setError("Name is required");
      return;
    }
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      setError("Must be PascalCase (e.g., Card, HeroSection)");
      return;
    }

    setLoading(true);
    try {
      if (mode === "create") {
        const result = await api.createComponent(name);
        if (result.success) {
          await loadFiles();
          // Open the new component for editing
          setCurrentFile(result.path);
          onClose();
        }
      } else if (mode === "extract" && nodeId && currentFile) {
        const result = await api.extractComponent(currentFile, nodeId, name);
        if (result.success) {
          await loadFiles();
          // Update the current page's AST (element was replaced with component tag)
          updateAst(result.sourceAst);
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to create component");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-xl border border-zinc-700 bg-zinc-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            {mode === "create" ? "New Component" : "Extract to Component"}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Component Name
            </label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Card, HeroSection"
              className="w-full rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 placeholder:text-zinc-600"
            />
            {error && (
              <p className="mt-1 text-xs text-red-400">{error}</p>
            )}
          </div>

          {mode === "create" && (
            <p className="text-xs text-zinc-500">
              Creates <span className="font-mono text-zinc-400">src/components/{name || "..."}.astro</span> with a basic template. You can then edit it visually and insert it into pages.
            </p>
          )}

          {mode === "extract" && (
            <p className="text-xs text-zinc-500">
              Extracts the selected element into <span className="font-mono text-zinc-400">src/components/{name || "..."}.astro</span> and replaces the original with{" "}
              <span className="font-mono text-zinc-400">&lt;{name || "..."} /&gt;</span>
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating..." : mode === "create" ? "Create Component" : "Extract"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
