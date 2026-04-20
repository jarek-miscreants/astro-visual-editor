import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  /** Unique key used to persist open/closed state in localStorage. */
  storageKey?: string;
  title: React.ReactNode;
  /** Optional right-aligned decoration (e.g. a count badge). */
  trailing?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Consistent collapsible section for the property panel. Persists state per
 * user when storageKey is provided so sections stay the way the user left them.
 */
export function CollapsibleSection({
  storageKey,
  title,
  trailing,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(() => {
    if (!storageKey || typeof window === "undefined") return defaultOpen;
    const saved = window.localStorage.getItem(storageKey);
    if (saved === null) return defaultOpen;
    return saved === "1";
  });

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, open ? "1" : "0");
  }, [open, storageKey]);

  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">{title}</span>
        {trailing}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
