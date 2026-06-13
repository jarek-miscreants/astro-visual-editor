import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { RepeaterFieldType } from "@tve/shared";
import { api } from "../../lib/api-client";
import { toast } from "../../store/toast-store";

/** A field row in the editor. `originalName` is set for fields that already
 *  exist in source (so a name change = rename, absence = remove); undefined for
 *  newly-added rows (= add). */
interface FieldRow {
  originalName?: string;
  name: string;
  type: RepeaterFieldType;
}

interface EditRepeaterFieldsDialogProps {
  componentPath: string;
  arrayName: string;
  /** Current fields (with best-effort inferred types). */
  initialFields: { name: string; type: RepeaterFieldType }[];
  onClose: () => void;
  /** Called after changes are applied so the caller can refetch. */
  onApplied: () => void;
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

export function EditRepeaterFieldsDialog({
  componentPath,
  arrayName,
  initialFields,
  onClose,
  onApplied,
}: EditRepeaterFieldsDialogProps) {
  const [rows, setRows] = useState<FieldRow[]>(
    initialFields.map((f) => ({ originalName: f.name, name: f.name, type: f.type }))
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function setRow(i: number, patch: Partial<FieldRow>) {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((cur) => [...cur, { name: "", type: "text" }]);
  }
  function removeRow(i: number) {
    setRows((cur) => cur.filter((_, idx) => idx !== i));
  }

  function validate(): string | null {
    if (rows.length === 0) return "Keep at least one field.";
    const seen = new Set<string>();
    for (const r of rows) {
      if (!IDENT_RE.test(r.name)) return `"${r.name || "(empty)"}" is not a valid field name.`;
      if (seen.has(r.name)) return `Duplicate field "${r.name}".`;
      seen.add(r.name);
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    // Diff against the originals.
    const keptOriginals = new Set(
      rows.filter((r) => r.originalName).map((r) => r.originalName!)
    );
    const removes = initialFields
      .map((f) => f.name)
      .filter((name) => !keptOriginals.has(name));
    const renames = rows.filter(
      (r) => r.originalName && r.name !== r.originalName
    );
    const adds = rows.filter((r) => !r.originalName);

    if (removes.length === 0 && renames.length === 0 && adds.length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    try {
      // Order matters: rename first (keeps identity), then remove, then add.
      for (const r of renames) {
        await api.renameRepeaterField(componentPath, arrayName, r.originalName!, r.name);
      }
      for (const name of removes) {
        await api.removeRepeaterField(componentPath, arrayName, name);
      }
      for (const r of adds) {
        await api.addRepeaterField(componentPath, arrayName, r.name, r.type);
      }
      onApplied();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to apply field changes");
      onApplied(); // refetch so the panel reflects whatever did land
    } finally {
      setBusy(false);
    }
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
          <h2 className="tve-panel__title">Edit fields · {arrayName}</h2>
          <button onClick={onClose} className="tve-icon-btn tve-icon-btn--sm">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 tve-prop-stack">
          <div className="tve-prop-field">
            <label className="tve-prop-field__label">Fields</label>
            <div className="tve-prop-stack--sm">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.name}
                    onChange={(e) => setRow(i, { name: e.target.value })}
                    placeholder="field name"
                    className="tve-prop-input"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <select
                    value={row.type}
                    onChange={(e) => setRow(i, { type: e.target.value as RepeaterFieldType })}
                    className="tve-prop-input"
                    style={{ width: "8rem" }}
                    disabled={!!row.originalName}
                    title={row.originalName ? "Type can't be changed for existing fields" : undefined}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="tve-prop-icon-action tve-prop-icon-action--danger"
                    aria-label={`Remove field ${i + 1}`}
                    disabled={rows.length === 1}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="tve-repeater-add"
              style={{ marginTop: 8 }}
            >
              <Plus size={12} />
              Add field
            </button>
          </div>

          <p className="tve-prop-section__hint">
            Renaming and adding update both the data and the card. Removing drops
            the data only — a leftover spot in the card just renders empty.
          </p>

          {error && (
            <p className="tve-prop-section__hint" style={{ color: "var(--shell-danger)" }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="tve-button-secondary">
              Cancel
            </button>
            <button type="submit" className="tve-button-accent" disabled={busy}>
              {busy ? "Applying…" : "Apply changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
