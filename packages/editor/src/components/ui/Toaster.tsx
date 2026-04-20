import { CheckCircle2, Info, AlertTriangle, X } from "lucide-react";
import { useToastStore } from "../../store/toast-store";

/** Renders the active toast queue. Mount once near the editor root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex flex-col-reverse gap-2">
      {toasts.map((t) => {
        const { icon, accent } = variantStyles(t.variant);
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex min-w-[240px] max-w-[360px] items-start gap-2.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 shadow-lg shadow-black/40 animate-in-toast"
          >
            <span className={`mt-0.5 shrink-0 ${accent}`}>{icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-zinc-100">{t.message}</div>
              {t.description && (
                <div className="mt-0.5 truncate text-[11px] text-zinc-400">{t.description}</div>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-zinc-600 hover:text-zinc-300"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function variantStyles(variant: string | undefined) {
  switch (variant) {
    case "success":
      return { icon: <CheckCircle2 size={14} />, accent: "text-emerald-400" };
    case "error":
      return { icon: <AlertTriangle size={14} />, accent: "text-red-400" };
    default:
      return { icon: <Info size={14} />, accent: "text-blue-400" };
  }
}
