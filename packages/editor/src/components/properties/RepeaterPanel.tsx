import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Trash2,
  Globe,
  FileText,
  SlidersHorizontal,
} from "lucide-react";
import type { RepeaterArray, LoopBinding, LinkTarget, RepeaterFieldType } from "@tve/shared";
import { api } from "../../lib/api-client";
import { toast } from "../../store/toast-store";
import { useLinkTargets, groupLinkTargets, LinkTargetPicker } from "./LinkSection";
import { EditRepeaterFieldsDialog } from "../dialogs/EditRepeaterFieldsDialog";

/** Best-effort field type from existing values (text/textarea/link/image all
 *  read back as strings, so those default to "text" — only used to seed the
 *  edit dialog's display + new-field defaults). */
function inferFieldType(
  items: Record<string, string | number | boolean>[],
  field: string
): RepeaterFieldType {
  for (const item of items) {
    const v = item[field];
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "text";
  }
  return "text";
}

/** Field names that should use the link picker (manual URL or page dropdown). */
const LINK_FIELDS = new Set(["href", "url", "link", "to"]);

interface RepeaterPanelProps {
  /** Component file whose frontmatter arrays we edit (project-relative). */
  componentPath: string;
  /** The bound expression that led here, e.g. `{feature.title}`. Used to scope
   *  to the owning array and focus the matching field. Optional. */
  focusExpression?: string | null;
}

/** Parse `{feature.title}` → { itemVar: "feature", field: "title" }. */
function parseExpression(
  expr: string | null | undefined
): { itemVar: string; field: string } | null {
  if (!expr) return null;
  const m = expr.match(/\{?\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/);
  return m ? { itemVar: m[1], field: m[2] } : null;
}

/**
 * Repeater editor for component-local list content — a `const X = [{…}]` array
 * driving a `{X.map(…)}` loop. Surfaced when the user lands on loop-rendered
 * content (whose text is an un-editable `{item.field}` binding). Editing a field
 * rewrites `X[i].field` in the frontmatter via the server, sidestepping the
 * inline-edit corruption / instance-identity problems of `.map()` bodies.
 */
export function RepeaterPanel({ componentPath, focusExpression }: RepeaterPanelProps) {
  const [arrays, setArrays] = useState<RepeaterArray[] | null>(null);
  const [bindings, setBindings] = useState<LoopBinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped after add/remove to re-fetch the array (structure changed on disk).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getComponentData(componentPath)
      .then((res) => {
        if (cancelled) return;
        setArrays(res.arrays);
        setBindings(res.loopBindings);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load list content");
      });
    return () => {
      cancelled = true;
    };
  }, [componentPath, reloadKey]);

  const focus = useMemo(() => parseExpression(focusExpression), [focusExpression]);

  // Resolve the array the bound expression refers to (itemVar → arrayName via a
  // .map() binding). When unresolved, show every editable array in the file.
  const focusedArrayName = useMemo(() => {
    if (!focus) return null;
    const binding = bindings.find((b) => b.itemVar === focus.itemVar);
    return binding?.arrayName ?? null;
  }, [focus, bindings]);

  if (error) {
    return (
      <div className="tve-prop-section">
        <div className="tve-prop-section__header">List content</div>
        <p className="tve-prop-section__hint">{error}</p>
      </div>
    );
  }
  if (!arrays) return null; // loading — keep the panel quiet
  if (arrays.length === 0) return null;

  const shown = focusedArrayName
    ? arrays.filter((a) => a.name === focusedArrayName)
    : arrays;
  if (shown.length === 0) return null;

  return (
    <>
      {shown.map((array) => (
        <RepeaterArrayEditor
          key={array.name}
          componentPath={componentPath}
          array={array}
          focusField={focusedArrayName === array.name ? focus?.field ?? null : null}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      ))}
    </>
  );
}

function RepeaterArrayEditor({
  componentPath,
  array,
  focusField,
  onChanged,
}: {
  componentPath: string;
  array: RepeaterArray;
  focusField: string | null;
  onChanged: () => void;
}) {
  // Local copy so edits reflect immediately; the file write feeds the iframe
  // via HMR, but the inputs read from here.
  const [items, setItems] = useState(array.items);
  useEffect(() => setItems(array.items), [array]);
  const [busy, setBusy] = useState(false);
  const [showFields, setShowFields] = useState(false);
  // Index to auto-expand after an add (the new, empty item) so the user sees
  // the blank fields to fill in.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  async function commit(
    index: number,
    field: string,
    value: string | number | boolean
  ) {
    const prev = items[index]?.[field];
    if (prev === value) return;
    // Optimistic local update.
    setItems((cur) =>
      cur.map((it, i) => (i === index ? { ...it, [field]: value } : it))
    );
    try {
      await api.updateComponentData({
        path: componentPath,
        arrayName: array.name,
        index,
        field,
        value,
      });
    } catch (err: any) {
      // Roll back on failure.
      setItems((cur) =>
        cur.map((it, i) => (i === index ? { ...it, [field]: prev as any } : it))
      );
      toast.error("Couldn't save list item", err?.message ?? "Rejected");
    }
  }

  async function addItem() {
    if (busy) return;
    setBusy(true);
    try {
      await api.addComponentArrayItem(componentPath, array.name);
      setOpenIndex(items.length); // the new item lands at the end
      onChanged();
    } catch (err: any) {
      toast.error("Couldn't add item", err?.message ?? "Rejected");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(index: number) {
    if (busy) return;
    setBusy(true);
    try {
      await api.removeComponentArrayItem(componentPath, array.name, index);
      setOpenIndex(null);
      onChanged();
    } catch (err: any) {
      toast.error("Couldn't remove item", err?.message ?? "Rejected");
    } finally {
      setBusy(false);
    }
  }

  async function moveItem(index: number, dir: "up" | "down") {
    if (busy) return;
    setBusy(true);
    try {
      await api.moveComponentArrayItem(componentPath, array.name, index, dir);
      // Keep the moved item expanded at its new position.
      setOpenIndex(dir === "up" ? index - 1 : index + 1);
      onChanged();
    } catch (err: any) {
      toast.error("Couldn't move item", err?.message ?? "Rejected");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tve-prop-section">
      <div
        className="tve-prop-section__header"
        style={{ display: "flex", alignItems: "center" }}
      >
        <span style={{ flex: 1 }}>
          List content · {array.name}
          <span style={{ opacity: 0.5, fontWeight: 400 }}> ({array.count})</span>
        </span>
        <button
          type="button"
          className="tve-prop-icon-action"
          title="Edit fields"
          aria-label="Edit fields"
          onClick={() => setShowFields(true)}
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>
      {showFields && (
        <EditRepeaterFieldsDialog
          componentPath={componentPath}
          arrayName={array.name}
          initialFields={array.fields.map((name) => ({
            name,
            type: inferFieldType(array.items, name),
          }))}
          onClose={() => setShowFields(false)}
          onApplied={onChanged}
        />
      )}
      <div className="tve-prop-stack">
        {items.map((item, index) => (
          <RepeaterItem
            key={index}
            index={index}
            item={item}
            fields={array.fields}
            focusField={focusField}
            defaultOpen={index === 0 || index === openIndex}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            onMove={(dir) => moveItem(index, dir)}
            onDelete={() => removeItem(index)}
            onCommit={(field, value) => commit(index, field, value)}
          />
        ))}
      </div>
      <button
        type="button"
        className="tve-repeater-add"
        disabled={busy}
        onClick={addItem}
      >
        <Plus size={12} />
        Add item
      </button>
    </div>
  );
}

function RepeaterItem({
  index,
  item,
  fields,
  focusField,
  defaultOpen,
  canMoveUp,
  canMoveDown,
  onMove,
  onDelete,
  onCommit,
}: {
  index: number;
  item: Record<string, string | number | boolean>;
  fields: string[];
  focusField: string | null;
  defaultOpen?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: "up" | "down") => void;
  onDelete: () => void;
  onCommit: (field: string, value: string | number | boolean) => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  // A short, recognizable label for the collapsed row. Prefer a human-facing
  // field (title/label/name/heading) over a slug-y `id`; fall back to the first
  // string field, then the index.
  const preferred = ["title", "label", "name", "heading"].find(
    (f) => typeof item[f] === "string" && String(item[f]).trim()
  );
  const titleField =
    preferred ?? fields.find((f) => f !== "id" && typeof item[f] === "string");
  const title = titleField ? String(item[titleField]) : `Item ${index + 1}`;

  return (
    <div className="tve-repeater-item" data-open={open || undefined}>
      <div className="tve-repeater-item__head">
        <button
          type="button"
          className="tve-repeater-item__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="tve-repeater-item__index">#{index + 1}</span>
          <span className="tve-repeater-item__title">{title}</span>
        </button>
        <button
          type="button"
          className="tve-prop-icon-action"
          title="Move up"
          aria-label={`Move item ${index + 1} up`}
          disabled={!canMoveUp}
          onClick={() => onMove("up")}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          className="tve-prop-icon-action"
          title="Move down"
          aria-label={`Move item ${index + 1} down`}
          disabled={!canMoveDown}
          onClick={() => onMove("down")}
        >
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          className="tve-prop-icon-action tve-prop-icon-action--danger"
          title="Remove item"
          aria-label={`Remove item ${index + 1}`}
          onClick={onDelete}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {open && (
        <div className="tve-prop-stack--sm tve-repeater-item__body">
          {fields.map((field) => {
            const value = item[field];
            if (value === undefined) return null; // non-literal on this item
            return (
              <RepeaterField
                key={field}
                label={field}
                value={value}
                highlight={focusField === field}
                onCommit={(next) => onCommit(field, next)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RepeaterField({
  label,
  value,
  highlight,
  onCommit,
}: {
  label: string;
  value: string | number | boolean;
  /** The field the bound expression pointed at — labeled so the user can spot
   *  it across items (we can't resolve which item index was clicked). */
  highlight?: boolean;
  onCommit: (value: string | number | boolean) => void;
}) {
  const labelClass = highlight
    ? "tve-prop-field__label tve-repeater-field__label--match"
    : "tve-prop-field__label";

  // href/url/link/to fields get the manual-URL-or-page-dropdown picker.
  if (typeof value === "string" && LINK_FIELDS.has(label.toLowerCase())) {
    return (
      <div className="tve-prop-field">
        <label className={labelClass}>{label}</label>
        <LinkField value={value} onCommit={(v) => onCommit(v)} />
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <label className="tve-prop-field tve-repeater-field--bool">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onCommit(e.target.checked)}
        />
        <span className={labelClass}>{label}</span>
      </label>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="tve-prop-field">
        <label className={labelClass}>{label}</label>
        <input
          type="number"
          defaultValue={value}
          className="tve-prop-input"
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n !== value) onCommit(n);
          }}
        />
      </div>
    );
  }

  // string
  const text = String(value);
  const rows = Math.min(6, Math.max(1, Math.ceil(text.length / 40)));
  return (
    <div className="tve-prop-field">
      <label className={labelClass}>{label}</label>
      <textarea
        key={text}
        defaultValue={text}
        rows={rows}
        className="tve-prop-textarea"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        onBlur={(e) => {
          if (e.target.value !== text) onCommit(e.target.value);
        }}
      />
    </div>
  );
}

/**
 * Link control for repeater href-style fields: a URL/Page toggle, with a manual
 * URL input or the internal page/content picker. Mirrors the anchor LinkSection
 * but commits a plain string value (no anchor target/rel attributes).
 */
function LinkField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const { linkTargets, loading, error } = useLinkTargets();
  const groups = useMemo(() => groupLinkTargets(linkTargets), [linkTargets]);
  const selectedTarget = useMemo(
    () => linkTargets.find((t) => !t.disabled && t.url === value) ?? null,
    [linkTargets, value]
  );

  const [mode, setMode] = useState<"url" | "page">("url");
  const [modeTouched, setModeTouched] = useState(false);
  // Until the user picks a mode, follow the value: a known target → Page.
  useEffect(() => {
    if (!modeTouched) setMode(selectedTarget ? "page" : "url");
  }, [selectedTarget, modeTouched]);

  const hasInternalTargets = loading || linkTargets.length > 0;

  return (
    <div className="tve-prop-stack--xs">
      {hasInternalTargets && (
        <div className="tve-prop-mode">
          <button
            type="button"
            className="tve-prop-mode__btn"
            data-active={mode === "url" || undefined}
            onClick={() => {
              setModeTouched(true);
              setMode("url");
            }}
          >
            <Globe size={9} />
            URL
          </button>
          <button
            type="button"
            className="tve-prop-mode__btn"
            data-active={mode === "page" || undefined}
            onClick={() => {
              setModeTouched(true);
              setMode("page");
            }}
          >
            <FileText size={9} />
            Page
          </button>
        </div>
      )}

      {mode === "url" ? (
        <input
          type="text"
          key={value}
          defaultValue={value}
          placeholder="https://… or /path or #anchor"
          className="tve-prop-input"
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== value) onCommit(next);
          }}
        />
      ) : (
        <LinkTargetPicker
          value={value}
          selectedTarget={selectedTarget}
          groups={groups}
          loading={loading}
          error={error}
          onChange={(v: string) => onCommit(v)}
        />
      )}
    </div>
  );
}
