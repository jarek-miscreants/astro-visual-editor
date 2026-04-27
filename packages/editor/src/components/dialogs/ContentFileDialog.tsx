import { useState, useEffect, useRef, useMemo } from "react";
import { X } from "lucide-react";
import { useContentStore } from "../../store/content-store";
import { ApiError } from "../../lib/api-client";

interface ContentFileDialogProps {
  /** Optional pre-filled collection (when invoked from a specific collection's "+" button) */
  defaultCollection?: string;
  onClose: () => void;
}

const NEW_COLLECTION_VALUE = "__new__";

export function ContentFileDialog({ defaultCollection, onClose }: ContentFileDialogProps) {
  const files = useContentStore((s) => s.files);
  const createFile = useContentStore((s) => s.createFile);

  const existingCollections = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(f.collection);
    return Array.from(set).sort();
  }, [files]);

  const initialCollection =
    defaultCollection && existingCollections.includes(defaultCollection)
      ? defaultCollection
      : existingCollections[0] ?? NEW_COLLECTION_VALUE;

  const [collectionChoice, setCollectionChoice] = useState<string>(initialCollection);
  const [newCollection, setNewCollection] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"md" | "mdx">("md");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const slugRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    slugRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const collection =
    collectionChoice === NEW_COLLECTION_VALUE ? newCollection.trim() : collectionChoice;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!collection) {
      setError("Collection is required");
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(collection)) {
      setError("Collection name must start with a letter/digit; only letters, digits, - and _ allowed");
      return;
    }
    if (!slug) {
      setError("Slug is required");
      return;
    }
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug)) {
      setError("Slug must be lowercase letters, digits, hyphens, or underscores");
      return;
    }

    const frontmatter: Record<string, any> = {};
    if (title.trim()) frontmatter.title = title.trim();
    frontmatter.date = new Date().toISOString().slice(0, 10);

    setLoading(true);
    try {
      await createFile({
        collection,
        slug,
        format,
        frontmatter,
        body: "",
      });
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === "EEXIST") {
        setError("A file with that slug already exists in this collection");
      } else {
        setError(err.message || "Failed to create file");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="w-[28rem] border border-zinc-700 bg-zinc-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">New Content Entry</h2>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Collection</label>
            {existingCollections.length > 0 ? (
              <select
                value={collectionChoice}
                onChange={(e) => setCollectionChoice(e.target.value)}
                className="w-full border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500"
              >
                {existingCollections.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_COLLECTION_VALUE}>+ New collection…</option>
              </select>
            ) : (
              <input
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                placeholder="e.g., blog"
                className="w-full border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500 placeholder:text-zinc-600"
              />
            )}
            {collectionChoice === NEW_COLLECTION_VALUE && existingCollections.length > 0 && (
              <input
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                placeholder="New collection name (e.g., blog)"
                className="mt-2 w-full border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500 placeholder:text-zinc-600"
              />
            )}
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Slug</label>
            <input
              ref={slugRef}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g., my-first-post"
              className="w-full border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500 placeholder:text-zinc-600"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Goes into frontmatter"
              className="w-full border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500 placeholder:text-zinc-600"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Format</label>
            <div className="flex gap-2">
              {(["md", "mdx"] as const).map((f) => (
                <button
                  type="button"
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`px-3 py-1.5 text-xs border ${
                    format === f
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                      : "border-zinc-600 bg-zinc-900 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  .{f}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-zinc-500">
            Creates{" "}
            <span className="font-mono text-zinc-400">
              src/content/{collection || "..."}/{slug || "..."}.{format}
            </span>
            . Existing collections reuse their detected root.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !collection || !slug}
              className="bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
