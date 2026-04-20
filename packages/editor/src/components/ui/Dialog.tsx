import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Width preset. Defaults to "md" (28rem). */
  size?: "sm" | "md" | "lg";
}

const SIZE: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

/** Minimal portal-based modal. Handles Esc and backdrop click to close. */
export function Dialog({ open, onClose, title, description, children, size = "md" }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${SIZE[size]} overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div className="min-w-0 flex-1">
              {title && <div className="text-[13px] font-semibold text-zinc-100">{title}</div>}
              {description && (
                <div className="mt-0.5 text-[11px] text-zinc-400">{description}</div>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div>{children}</div>
      </div>
    </div>,
    document.body
  );
}
