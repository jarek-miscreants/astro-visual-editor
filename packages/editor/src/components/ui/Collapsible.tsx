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
    <div style={{ borderBottom: "1px solid var(--prop-section-border)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="tve-prop-section__header tve-prop-section__header--toggle"
        style={{ padding: "8px 12px", margin: 0 }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span style={{ flex: 1 }}>{title}</span>
        {trailing}
      </button>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}
