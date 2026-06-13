import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { RepeaterFieldSpec, RepeaterFieldType, RepeaterLayout } from "@tve/shared";

interface InsertRepeaterDialogProps {
  onClose: () => void;
  onSubmit: (config: {
    arrayName: string;
    itemVar: string;
    layout: RepeaterLayout;
    fields: RepeaterFieldSpec[];
  }) => void;
}

const FIELD_TYPES: { value: RepeaterFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "link", label: "Link" },
  { value: "image", label: "Image" },
  { value: "boolean", label: "Toggle" },
  { value: "number", label: "Number" },
];

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

const DEFAULT_FIELDS: RepeaterFieldSpec[] = [
  { name: "title", type: "text" },
  { name: "body", type: "textarea" },
  { name: "href", type: "link" },
];

export function InsertRepeaterDialog({ onClose, onSubmit }: InsertRepeaterDialogProps) {
  const [arrayName, setArrayName] = useState("items");
  const [layout, setLayout] = useState<RepeaterLayout>("card-grid");
  const [fields, setFields] = useState<RepeaterFieldSpec[]>(DEFAULT_FIELDS);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function setField(i: number, patch: Partial<RepeaterFieldSpec>) {
    setFields((cur) => cur.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((cur) => [...cur, { name: "", type: "text" }]);
  }
  function removeField(i: number) {
    setFields((cur) => cur.filter((_, idx) => idx !== i));
  }

  function validate(): string | null {
    if (!IDENT_RE.test(arrayName)) return "List name must be a valid identifier (e.g. items, features).";
    if (fields.length === 0) return "Add at least one field.";
    const seen = new Set<string>();
    for (const f of fields) {
      if (!IDENT_RE.test(f.name)) return `"${f.name || "(empty)"}" is not a valid field name.`;
      if (seen.has(f.name)) return `Duplicate field "${f.name}".`;
      seen.add(f.name);
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    onSubmit({ arrayName, itemVar: "item", layout, fields });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div
        className="w-[30rem]"
        style={{
          backgroundColor: "var(--shell-bg-subtle)",
          color: "var(--shell-text)",
          border: "1px solid var(--shell-border-strong)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <h2 className="tve-panel__title">Insert list</h2>
          <button onClick={onClose} className="tve-icon-btn tve-icon-btn--sm">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 tve-prop-stack">
          <div className="tve-prop-field">
            <label className="tve-prop-field__label">List name</label>
            <input
              ref={inputRef}
              value={arrayName}
              onChange={(e) => setArrayName(e.target.value)}
              placeholder="items, features, testimonials"
              className="tve-prop-input"
            />
            <p className="tve-prop-section__hint" style={{ marginTop: 4 }}>
              Renders as <code>{`{${arrayName || "items"}.map(...)}`}</code> with one empty item to start.
            </p>
          </div>

          <div className="tve-prop-field">
            <label className="tve-prop-field__label">Layout</label>
            <div className="tve-prop-toggle-group">
              <button
                type="button"
                onClick={() => setLayout("card-grid")}
                className="tve-prop-toggle"
                data-active={layout === "card-grid" || undefined}
              >
                Card grid
              </button>
              <button
                type="button"
                onClick={() => setLayout("stacked-list")}
                className="tve-prop-toggle"
                data-active={layout === "stacked-list" || undefined}
              >
                Stacked list
              </button>
            </div>
          </div>

          <div className="tve-prop-field">
            <label className="tve-prop-field__label">Fields</label>
            <div className="tve-prop-stack--sm">
              {fields.map((field, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={field.name}
                    onChange={(e) => setField(i, { name: e.target.value })}
                    placeholder="field name"
                    className="tve-prop-input"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <select
                    value={field.type}
                    onChange={(e) => setField(i, { type: e.target.value as RepeaterFieldType })}
                    className="tve-prop-input"
                    style={{ width: "8rem" }}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="tve-prop-icon-action tve-prop-icon-action--danger"
                    aria-label={`Remove field ${i + 1}`}
                    disabled={fields.length === 1}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addField}
              className="tve-repeater-add"
              style={{ marginTop: 8 }}
            >
              <Plus size={12} />
              Add field
            </button>
          </div>

          {error && (
            <p className="tve-prop-section__hint" style={{ color: "var(--shell-danger)" }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="tve-button-secondary">
              Cancel
            </button>
            <button type="submit" className="tve-button-accent">
              Insert list
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
