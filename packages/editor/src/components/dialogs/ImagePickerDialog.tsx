import { useState, useEffect, useMemo, useRef } from "react";
import { X, Search, ImageOff, Lock } from "lucide-react";
import type { AssetInfo } from "@tve/shared";
import { api, assetRawUrl } from "../../lib/api-client";

interface ImagePickerDialogProps {
  /** Current src value, so the matching asset is highlighted on open. */
  currentSrc?: string;
  /** Called with the chosen asset's public URL (e.g. `/images/foo.webp`). */
  onSelect: (publicUrl: string) => void;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Webflow-style image browser. Lists every image in the project's `public/`
 * and `src/` trees with thumbnails. Selecting a `public/` asset writes its
 * URL into the `src` attribute. `src/` assets are shown for reference but
 * disabled — they need a frontmatter import (a separate, larger feature) and
 * can't be referenced by a plain string.
 */
export function ImagePickerDialog({
  currentSrc,
  onSelect,
  onClose,
}: ImagePickerDialogProps) {
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
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

  const filtered = useMemo(() => {
    if (!assets) return [];
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(
      (a) => a.name.toLowerCase().includes(q) || a.relPath.toLowerCase().includes(q)
    );
  }, [assets, query]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="flex h-[600px] max-h-[85vh] w-[760px] max-w-[92vw] flex-col border border-zinc-700 bg-zinc-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Choose image</h2>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-zinc-700 px-4 py-2">
          <div className="flex items-center gap-2 border border-zinc-600 bg-zinc-900 px-2">
            <Search size={13} className="text-zinc-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images…"
              className="w-full bg-transparent py-1.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
              <ImageOff size={28} />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {!error && assets === null && (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Loading images…
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
            </div>
          )}

          {!error && filtered.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
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
                        : `${asset.relPath} — in src/, needs an import (edit in source)`
                    }
                    onClick={() => {
                      if (asset.publicUrl) {
                        onSelect(asset.publicUrl);
                        onClose();
                      }
                    }}
                    className="group flex flex-col border bg-zinc-900 text-left transition-colors"
                    style={{
                      borderColor: isCurrent ? "rgb(59 130 246)" : "rgb(63 63 70)",
                      cursor: selectable ? "pointer" : "not-allowed",
                      opacity: selectable ? 1 : 0.55,
                    }}
                  >
                    <div className="relative flex h-[110px] items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#27272a_0%_25%,#1c1c1f_0%_50%)] bg-[length:16px_16px]">
                      <img
                        src={assetRawUrl(asset.relPath)}
                        alt={asset.name}
                        loading="lazy"
                        className="max-h-full max-w-full object-contain"
                      />
                      {!selectable && (
                        <div className="absolute right-1 top-1 flex items-center gap-1 bg-zinc-950/80 px-1 py-0.5 text-[10px] text-amber-400">
                          <Lock size={9} />
                          src
                        </div>
                      )}
                    </div>
                    <div className="border-t border-zinc-700 px-2 py-1.5">
                      <div className="truncate text-xs text-zinc-300" title={asset.name}>
                        {asset.name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <span>{asset.ext.slice(1).toUpperCase()}</span>
                        <span>{formatSize(asset.size)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-zinc-700 px-4 py-2 text-[11px] text-zinc-500">
          Images in <span className="font-mono text-zinc-400">public/</span> can be
          applied directly. Images in <span className="font-mono text-zinc-400">src/</span>{" "}
          need a frontmatter import — edit those in source for now.
        </div>
      </div>
    </div>
  );
}
