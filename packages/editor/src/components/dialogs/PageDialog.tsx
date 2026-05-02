import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { api } from "../../lib/api-client";
import { useEditorStore } from "../../store/editor-store";

interface PageDialogProps {
  onClose: () => void;
}

type Template = "blank" | "layout";

const ROUTE_RE = /^[a-z0-9][a-z0-9-_]*(\/[a-z0-9][a-z0-9-_]*)*$/i;

export function PageDialog({ onClose }: PageDialogProps) {
  const [route, setRoute] = useState("");
  const [template, setTemplate] = useState<Template>("layout");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadFiles = useEditorStore((s) => s.loadFiles);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const cleanRoute = route.replace(/^\/+|\/+$/g, "");
  const filePath = cleanRoute ? `src/pages/${cleanRoute}.astro` : "";
  const url = cleanRoute
    ? "/" + cleanRoute.replace(/\/index$/, "/").replace(/^index$/, "")
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!cleanRoute) {
      setError("Route is required");
      return;
    }
    if (/[\[\]]/.test(cleanRoute)) {
      setError("Brackets aren't allowed (dynamic routes need a separate flow)");
      return;
    }
    if (!ROUTE_RE.test(cleanRoute)) {
      setError("Use kebab-case path segments (a-z, 0-9, -, _, separated by /)");
      return;
    }

    setLoading(true);
    try {
      const result = await api.createPage(cleanRoute, template);
      if (result.success) {
        await loadFiles();
        // Open the new page so the user lands on it immediately
        setCurrentFile(result.path);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || "Failed to create page");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div
        className="w-[26rem]"
        style={{
          backgroundColor: "var(--shell-bg-elevated)",
          border: "1px solid var(--shell-border-strong)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <h2 className="tve-panel__title">New page</h2>
          <button onClick={onClose} className="tve-icon-btn tve-icon-btn--sm">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 tve-prop-stack">
          <div className="tve-prop-field">
            <label className="tve-prop-field__label">Route</label>
            <input
              ref={inputRef}
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              placeholder="about, blog/welcome, services/pricing"
              className="tve-prop-input"
              style={{ fontFamily: "ui-monospace, monospace" }}
            />
            {error && (
              <p
                className="tve-prop-section__hint"
                style={{ color: "var(--shell-danger)", marginTop: 4 }}
              >
                {error}
              </p>
            )}
            {cleanRoute && !error && (
              <p
                className="tve-prop-section__hint"
                style={{ marginTop: 4, fontFamily: "ui-monospace, monospace" }}
              >
                {filePath} → {url}
              </p>
            )}
          </div>

          <div className="tve-prop-field">
            <label className="tve-prop-field__label">Template</label>
            <div className="tve-prop-toggle-group">
              <button
                type="button"
                onClick={() => setTemplate("blank")}
                className="tve-prop-toggle"
                data-active={template === "blank" || undefined}
              >
                Blank
              </button>
              <button
                type="button"
                onClick={() => setTemplate("layout")}
                className="tve-prop-toggle"
                data-active={template === "layout" || undefined}
              >
                Wrap with project layout
              </button>
            </div>
            <p className="tve-prop-section__hint" style={{ marginTop: 4 }}>
              {template === "layout"
                ? "Auto-detects src/layouts/*.astro and wraps the starter heading in it. Falls back to a blank HTML doc if no layout is found."
                : "Bare <html>...<body> shell with a starter heading."}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="tve-button-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !cleanRoute}
              className="tve-button-accent"
              style={{
                opacity: loading || !cleanRoute ? 0.5 : 1,
                cursor: loading || !cleanRoute ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Creating..." : "Create page"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
