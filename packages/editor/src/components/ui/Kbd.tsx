/** Keyboard-shortcut badge — use inside Tooltip content or shortcut lists. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[10px] text-zinc-400">
      {children}
    </kbd>
  );
}
