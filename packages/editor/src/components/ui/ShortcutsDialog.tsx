import { create } from "zustand";
import { useEffect } from "react";
import { Dialog } from "./Dialog";
import { Kbd } from "./Kbd";

interface ShortcutsStore {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const useShortcutsStore = create<ShortcutsStore>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

/** Binds "?" (Shift+/) to toggle the cheat-sheet dialog. Skips while typing. */
export function useShortcutsHotkey() {
  const toggle = useShortcutsStore((s) => s.toggle);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?") return;
      const target = e.target as HTMLElement | null;
      if (target && isEditableTarget(target)) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

function isEditableTarget(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

type Group = { title: string; items: Array<[string[], string]> };

const GROUPS: Group[] = [
  {
    title: "Editing",
    items: [
      [["Delete"], "Delete selected element"],
      [["Ctrl", "D"], "Duplicate selected element"],
      [["Ctrl", "E"], "Toggle add element panel"],
      [["Ctrl", "Alt", "G"], "Wrap selected element in div"],
    ],
  },
  {
    title: "History",
    items: [
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Shift", "Z"], "Redo"],
    ],
  },
  {
    title: "Navigation",
    items: [
      [["Esc"], "Deselect / close overlay"],
      [["?"], "Open this cheat sheet"],
    ],
  },
  {
    title: "Session",
    items: [
      [["Ctrl", "Shift", "Q"], "Exit editor (kills dev server + backend)"],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useShortcutsStore((s) => s.open);
  const close = useShortcutsStore((s) => s.close);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Keyboard shortcuts"
      description="Work faster without leaving the keyboard."
      size="md"
    >
      <div className="divide-y divide-zinc-800">
        {GROUPS.map((group) => (
          <div key={group.title} className="px-4 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {group.title}
            </div>
            <ul className="space-y-1.5">
              {group.items.map(([keys, label]) => (
                <li
                  key={label}
                  className="flex items-center justify-between gap-3 text-[12px] text-zinc-300"
                >
                  <span>{label}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-[10px] text-zinc-600">+</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Programmatic open — for the toolbar button. */
export function openShortcutsDialog() {
  useShortcutsStore.getState().toggle();
}
