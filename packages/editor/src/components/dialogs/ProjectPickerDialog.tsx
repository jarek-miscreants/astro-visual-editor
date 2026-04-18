import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Clock, X, AlertTriangle } from "lucide-react";
import type { RecentProject } from "@tve/shared";
import { api } from "../../lib/api-client";

interface Props {
  onClose: () => void;
  onSwitched: () => void;
}

export function ProjectPickerDialog({ onClose, onSwitched }: Props) {
  const [path, setPath] = useState("");
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getRecentProjects()
      .then(({ projects }) => setRecent(projects))
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function handleOpen(target: string) {
    if (!target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.switchProject(target.trim());
      onSwitched();
    } catch (e: any) {
      setError(e?.message || "Failed to open project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-[520px] border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <FolderOpen size={12} className="text-zinc-400" />
            Open Astro project
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-4">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Project path
          </label>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/absolute/path/to/astro-project"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleOpen(path);
              }}
              className="flex-1 border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              onClick={() => handleOpen(path)}
              disabled={busy || !path.trim()}
              className="inline-flex h-8 items-center gap-1.5 bg-emerald-500 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <FolderOpen size={11} />}
              {busy ? "Opening…" : "Open"}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-600">
            Folder must contain <span className="font-mono text-zinc-500">astro.config.{"{mjs,ts,js}"}</span>.
            Dependencies must already be installed.
          </p>

          {error && (
            <div className="mt-3 flex items-start gap-2 border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {recent.length > 0 && (
          <div className="border-t border-zinc-800 px-4 py-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <Clock size={10} />
              Recent projects
            </div>
            <div className="space-y-0.5">
              {recent.map((p) => (
                <button
                  key={p.path}
                  onClick={() => handleOpen(p.path)}
                  disabled={busy}
                  className="flex w-full flex-col items-start gap-0.5 border border-transparent px-2 py-1.5 text-left text-[11px] transition-colors hover:border-zinc-800 hover:bg-zinc-900 disabled:opacity-50"
                >
                  <span className="font-medium text-zinc-200">{p.name}</span>
                  <span className="font-mono text-[10px] text-zinc-500 truncate w-full">
                    {p.path}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
