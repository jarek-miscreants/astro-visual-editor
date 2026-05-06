import { useEffect } from "react";
import { create } from "zustand";
import { Dialog } from "./Dialog";
import { Kbd } from "./Kbd";

type Phase = "idle" | "confirm" | "exiting" | "done" | "error";

interface ExitStore {
  phase: Phase;
  message: string;
  open: () => void;
  close: () => void;
  exit: () => Promise<void>;
}

const useExitStore = create<ExitStore>((set, get) => ({
  phase: "idle",
  message: "",
  open: () => set({ phase: "confirm", message: "" }),
  close: () => {
    if (get().phase === "exiting") return;
    set({ phase: "idle", message: "" });
  },
  exit: async () => {
    set({ phase: "exiting", message: "" });
    try {
      await fetch("/api/project/exit", { method: "POST" });
    } catch {
      // The server may close the connection before the response lands —
      // that's expected, the shutdown still happened.
    }
    set({ phase: "done", message: "Editor stopped. You can close this tab." });
    // Best-effort tab close. Only works if this tab was opened by JS, but
    // worth trying for users launching from a wrapper window.
    setTimeout(() => window.close(), 100);
  },
}));

function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Binds Ctrl+Shift+Q to open the exit confirmation. */
export function useExitHotkey() {
  const open = useExitStore((s) => s.open);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (e.key !== "Q" && e.key !== "q") return;
      if (isEditableTarget(e.target as HTMLElement | null)) return;
      e.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** Programmatic open — for a toolbar button. */
export function openExitDialog() {
  useExitStore.getState().open();
}

export function ExitOverlay() {
  const phase = useExitStore((s) => s.phase);
  const message = useExitStore((s) => s.message);
  const close = useExitStore((s) => s.close);
  const exit = useExitStore((s) => s.exit);

  // Enter confirms the exit when the dialog is open.
  useEffect(() => {
    if (phase !== "confirm") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        void exit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, exit]);

  if (phase === "idle") return null;

  if (phase === "exiting" || phase === "done") {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-6 py-5 shadow-2xl">
          <div className="text-[13px] font-semibold text-zinc-100">
            {phase === "exiting" ? "Stopping editor…" : "Editor stopped"}
          </div>
          <div className="text-[11px] text-zinc-400">
            {phase === "exiting"
              ? "Killing dev server and backend."
              : message || "You can close this tab."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog
      open={phase === "confirm"}
      onClose={close}
      title="Exit editor?"
      description="Stops the Astro dev server and shuts down the backend. Unsaved class changes are already written to disk; reopen with `tve` or `npm start` to come back."
      size="sm"
    >
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        <button
          onClick={close}
          className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={() => void exit()}
          className="rounded bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-500"
        >
          <span className="inline-flex items-center gap-2">
            Exit
            <span className="opacity-70">
              <Kbd>Enter</Kbd>
            </span>
          </span>
        </button>
      </div>
    </Dialog>
  );
}
