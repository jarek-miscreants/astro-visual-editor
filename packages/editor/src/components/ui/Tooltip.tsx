import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  /** Which side of the trigger the tooltip appears on. Defaults to "bottom". */
  side?: Side;
  /** Milliseconds the pointer must rest on the trigger before the tooltip opens. */
  delay?: number;
  /** Keyboard shortcut hint shown after the content (e.g. "Ctrl+Z"). */
  shortcut?: string;
}

/**
 * Lightweight tooltip. Portals into document.body so it escapes overflow
 * clipping on sidebars. Position is computed from the trigger's bounding rect.
 */
export function Tooltip({ content, children, side = "bottom", delay = 300, shortcut }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  function position() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const map: Record<Side, { top: number; left: number }> = {
      top: { top: r.top - gap, left: r.left + r.width / 2 },
      bottom: { top: r.bottom + gap, left: r.left + r.width / 2 },
      left: { top: r.top + r.height / 2, left: r.left - gap },
      right: { top: r.top + r.height / 2, left: r.right + gap },
    };
    setCoords(map[side]);
  }

  function onEnter() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      position();
      setOpen(true);
    }, delay);
  }
  function onLeave() {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }

  // Clone the child so we can attach handlers + ref
  const trigger = (
    <span
      ref={(el) => {
        triggerRef.current = el;
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      className="inline-flex"
    >
      {children}
    </span>
  );

  const translate: Record<Side, string> = {
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2",
    left: "-translate-x-full -translate-y-1/2",
    right: "-translate-y-1/2",
  };

  return (
    <>
      {trigger}
      {open && coords &&
        createPortal(
          <div
            role="tooltip"
            className={`pointer-events-none fixed z-[9999] ${translate[side]}`}
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 shadow-lg shadow-black/40">
              <span>{content}</span>
              {shortcut && (
                <span className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px font-mono text-[9px] text-zinc-500">
                  {shortcut}
                </span>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
