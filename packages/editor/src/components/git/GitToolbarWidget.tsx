import { useEffect, useState } from "react";
import { GitBranch, Loader2, AlertCircle, ArrowUpFromLine } from "lucide-react";
import { useGitStore } from "../../store/git-store";
import { Tooltip } from "../ui/Tooltip";
import { GitPanelDialog } from "./GitPanelDialog";

/**
 * Persistent git widget for the editor toolbar. Shows the current branch,
 * dirty-file count, and a button that opens the full git panel for committing.
 *
 * Hidden when the project isn't a git repo (`mode === "no-git"`).
 */
export function GitToolbarWidget() {
  const status = useGitStore((s) => s.status);
  const loading = useGitStore((s) => s.loading);
  const refresh = useGitStore((s) => s.refresh);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!status || status.mode === "no-git") return null;

  const dirtyCount = status.dirty.length;
  const ahead = status.ahead;
  const behind = status.behind;

  const branchLabel = status.currentBranch || "(detached)";
  const isLocalOnly = status.mode === "local-only";

  return (
    <>
      <div className="inline-flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 shadow-sm">
        <Tooltip
          content={
            <div className="flex flex-col gap-0.5 text-left">
              <span>Branch: {branchLabel}</span>
              {isLocalOnly && <span className="text-amber-300">No remote configured</span>}
              {ahead > 0 && <span>{ahead} commit{ahead === 1 ? "" : "s"} to push</span>}
              {behind > 0 && <span>{behind} commit{behind === 1 ? "" : "s"} behind</span>}
              {dirtyCount > 0 && (
                <span>
                  {dirtyCount} unsaved file{dirtyCount === 1 ? "" : "s"}
                </span>
              )}
              {dirtyCount === 0 && ahead === 0 && behind === 0 && (
                <span className="text-zinc-400">Working tree clean</span>
              )}
            </div>
          }
        >
          <button
            onClick={() => setOpen(true)}
            className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            {loading ? (
              <Loader2 size={11} className="animate-spin text-zinc-500" />
            ) : (
              <GitBranch size={11} className="text-zinc-500" />
            )}
            <span className="max-w-[140px] truncate">{branchLabel}</span>
            {dirtyCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-300">
                {dirtyCount}
              </span>
            )}
            {ahead > 0 && (
              <span className="ml-0.5 inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-300">
                <ArrowUpFromLine size={9} />
                {ahead}
              </span>
            )}
            {isLocalOnly && (
              <AlertCircle size={10} className="text-amber-400" aria-label="No remote" />
            )}
          </button>
        </Tooltip>
      </div>

      {open && <GitPanelDialog onClose={() => setOpen(false)} />}
    </>
  );
}
