import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ImageOff, Lock, Search, Upload, X } from "lucide-react";
import type { AssetInfo, AssetLocation } from "@tve/shared";
import { api, assetRawUrl } from "../../lib/api-client";

interface ImagePickerDialogProps {
  /** Current src value, so the matching asset is highlighted on open. */
  currentSrc?: string;
  /** Called with the chosen asset's public URL (e.g. `/images/foo.webp`). */
  onSelect: (publicUrl: string) => void;
  onClose: () => void;
}

type AssetFilter = "all" | AssetLocation;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filterLabel(filter: AssetFilter): string {
  if (filter === "public") return "Public";
  if (filter === "src") return "Source";
  return "All";
}

/**
 * Webflow-style image browser. Public assets can be selected directly; src/
 * assets are shown for reference until Astro import rewriting lands.
 */
export function ImagePickerDialog({
  currentSrc,
  onSelect,
  onClose,
}: ImagePickerDialogProps) {
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(() => {
    setError(null);
    api
      .listAssets()
      .then((res) => setAssets(res.assets))
      .catch((err) => setError(err?.message || "Failed to load assets"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listAssets()
      .then((res) => {
        if (!cancelled) setAssets(res.assets);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to load assets");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, [assets]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const counts = useMemo(() => {
    const list = assets ?? [];
    return {
      all: list.length,
      public: list.filter((a) => a.location === "public").length,
      src: list.filter((a) => a.location === "src").length,
    };
  }, [assets]);

  const filtered = useMemo(() => {
    if (!assets) return [];
    const q = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (filter !== "all" && asset.location !== filter) return false;
      if (!q) return true;
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.relPath.toLowerCase().includes(q) ||
        (asset.publicUrl ?? "").toLowerCase().includes(q)
      );
    });
  }, [assets, filter, query]);

  async function uploadAndSelect(file: File | null | undefined) {
    if (!file || uploading) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { asset } = await api.uploadAsset(file);
      setAssets((current) => (current ? [asset, ...current] : [asset]));
      if (asset.publicUrl) {
        onSelect(asset.publicUrl);
        onClose();
      } else {
        loadAssets();
      }
    } catch (err: any) {
      setUploadError(err?.message || "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="flex h-[680px] max-h-[88vh] w-[920px] max-w-[94vw] flex-col border border-zinc-700 bg-zinc-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Asset library</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Uploads go to <span className="font-mono text-zinc-400">public/images/</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-700 px-4 py-2">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 border border-zinc-600 bg-zinc-900 px-2">
            <Search size={13} className="text-zinc-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images..."
              className="w-full bg-transparent py-1.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>

          <div className="flex border border-zinc-700">
            {(["all", "public", "src"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`h-8 px-3 text-[11px] font-medium transition-colors ${
                  filter === item
                    ? "bg-zinc-700 text-zinc-100"
                    : "bg-zinc-900 text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {filterLabel(item)}{" "}
                <span className="text-zinc-500">
                  {item === "all" ? counts.all : counts[item]}
                </span>
              </button>
            ))}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,.svg,.ico,.bmp,.avif"
            className="hidden"
            onChange={(e) => uploadAndSelect(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex h-8 items-center gap-1.5 border border-emerald-600 bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload size={12} />
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>

        {uploadError && (
          <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">
            {uploadError}
          </div>
        )}

        <div
          className={`flex-1 overflow-auto p-4 ${
            dragging ? "outline outline-2 outline-emerald-500 outline-offset-[-6px]" : ""
          }`}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            uploadAndSelect(e.dataTransfer.files?.[0]);
          }}
        >
          {error && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
              <ImageOff size={28} />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {!error && assets === null && (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Loading images...
            </div>
          )}

          {!error && assets !== null && filtered.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
              <ImageOff size={28} />
              <p className="text-sm">
                {assets.length === 0
                  ? "No images found in public/ or src/"
                  : "No images match your search"}
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-2 inline-flex h-8 items-center gap-1.5 border border-zinc-600 px-3 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <Upload size={12} />
                Upload image
              </button>
            </div>
          )}

          {!error && filtered.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {filtered.map((asset) => {
                const selectable = asset.publicUrl !== null;
                const isCurrent =
                  !!asset.publicUrl && !!currentSrc && asset.publicUrl === currentSrc;
                return (
                  <button
                    key={asset.relPath}
                    type="button"
                    disabled={!selectable}
                    title={
                      selectable
                        ? asset.relPath
                        : `${asset.relPath} - in src/, needs an import`
                    }
                    onClick={() => {
                      if (asset.publicUrl) {
                        onSelect(asset.publicUrl);
                        onClose();
                      }
                    }}
                    className="group flex min-h-[202px] flex-col border bg-zinc-900 text-left transition-colors"
                    style={{
                      borderColor: isCurrent ? "rgb(59 130 246)" : "rgb(63 63 70)",
                      cursor: selectable ? "pointer" : "not-allowed",
                      opacity: selectable ? 1 : 0.58,
                    }}
                  >
                    <div className="relative flex h-[118px] items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#27272a_0%_25%,#1c1c1f_0%_50%)] bg-[length:16px_16px]">
                      <img
                        src={assetRawUrl(asset.relPath)}
                        alt={asset.name}
                        loading="lazy"
                        className="max-h-full max-w-full object-contain"
                      />
                      {isCurrent && (
                        <div className="absolute left-1 top-1 flex items-center gap-1 bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          <Check size={9} />
                          Selected
                        </div>
                      )}
                      {!selectable && (
                        <div className="absolute right-1 top-1 flex items-center gap-1 bg-zinc-950/85 px-1 py-0.5 text-[10px] text-amber-400">
                          <Lock size={9} />
                          src
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 border-t border-zinc-700 px-2 py-1.5">
                      <div className="truncate text-xs text-zinc-300" title={asset.name}>
                        {asset.name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <span>{asset.ext.slice(1).toUpperCase()}</span>
                        <span>{formatSize(asset.size)}</span>
                      </div>
                      <div className="truncate font-mono text-[10px] text-zinc-600" title={asset.relPath}>
                        {asset.publicUrl ?? asset.relPath}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-700 px-4 py-2 text-[11px] text-zinc-500">
          Drag an image here to upload and apply it. Public images can be applied directly;
          source images are preview-only until Astro import support is added.
        </div>
      </div>
    </div>
  );
}
