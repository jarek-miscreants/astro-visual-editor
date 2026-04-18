import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { useContentStore } from "../../store/content-store";

type FieldKind = "string" | "number" | "boolean" | "date" | "array" | "object";

function inferKind(value: unknown): FieldKind {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  // Heuristic: ISO-like date string
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "string";
}

export function FrontmatterForm() {
  const frontmatter = useContentStore((s) => s.current?.frontmatter ?? {});
  const updateField = useContentStore((s) => s.updateFrontmatterField);
  const renameField = useContentStore((s) => s.renameFrontmatterField);
  const removeField = useContentStore((s) => s.removeFrontmatterField);

  const entries = Object.entries(frontmatter);

  return (
    <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Frontmatter
        </div>
        <AddFieldButton existingKeys={Object.keys(frontmatter)} onAdd={(k, v) => updateField(k, v)} />
      </div>

      {entries.length === 0 && (
        <div className="text-[11px] text-zinc-500 italic">
          No frontmatter fields. Add one to get started.
        </div>
      )}

      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <FieldRow
            key={key}
            fieldKey={key}
            value={value}
            onChange={(v) => updateField(key, v)}
            onRename={(nk) => renameField(key, nk)}
            onRemove={() => removeField(key)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldRow({
  fieldKey,
  value,
  onChange,
  onRename,
  onRemove,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: any) => void;
  onRename: (newKey: string) => void;
  onRemove: () => void;
}) {
  const kind = inferKind(value);
  const [keyDraft, setKeyDraft] = useState(fieldKey);

  return (
    <div className="flex items-start gap-2">
      <input
        value={keyDraft}
        onChange={(e) => setKeyDraft(e.target.value)}
        onBlur={() => {
          if (keyDraft && keyDraft !== fieldKey) onRename(keyDraft);
          else setKeyDraft(fieldKey);
        }}
        className="w-32 shrink-0 border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-mono text-zinc-300 focus:border-blue-500 focus:outline-none"
      />
      <div className="flex-1">
        <FieldInput kind={kind} value={value} onChange={onChange} />
      </div>
      <button
        onClick={onRemove}
        className="mt-0.5 flex h-6 w-6 items-center justify-center text-zinc-600 hover:text-red-400 transition-colors"
        title="Remove field"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function FieldInput({
  kind,
  value,
  onChange,
}: {
  kind: FieldKind;
  value: any;
  onChange: (v: any) => void;
}) {
  if (kind === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 px-2 py-1 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-blue-500"
        />
        {value ? "true" : "false"}
      </label>
    );
  }

  if (kind === "number") {
    return (
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
      />
    );
  }

  if (kind === "date") {
    const str = value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value ?? "").slice(0, 10);
    return (
      <input
        type="date"
        value={str}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
      />
    );
  }

  if (kind === "array") {
    const items = Array.isArray(value) ? value : [];
    return (
      <input
        value={items.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
        placeholder="comma, separated, values"
        className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
      />
    );
  }

  if (kind === "object") {
    return (
      <textarea
        value={JSON.stringify(value, null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            // ignore invalid JSON while typing
          }
        }}
        rows={3}
        className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
      />
    );
  }

  // string
  const str = value == null ? "" : String(value);
  const multiline = str.length > 60 || str.includes("\n");
  return multiline ? (
    <textarea
      value={str}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      className="w-full resize-y border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
    />
  ) : (
    <input
      value={str}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 focus:border-blue-500 focus:outline-none"
    />
  );
}

function AddFieldButton({
  existingKeys,
  onAdd,
}: {
  existingKeys: string[];
  onAdd: (key: string, value: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<FieldKind>("string");

  function defaultValue(k: FieldKind): any {
    switch (k) {
      case "boolean":
        return false;
      case "number":
        return 0;
      case "date":
        return new Date().toISOString().slice(0, 10);
      case "array":
        return [];
      case "object":
        return {};
      default:
        return "";
    }
  }

  function submit() {
    const k = key.trim();
    if (!k || existingKeys.includes(k)) return;
    onAdd(k, defaultValue(kind));
    setKey("");
    setKind("string");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-6 items-center gap-1 border border-zinc-800 bg-zinc-900 px-2 text-[10px] font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
      >
        <Plus size={10} />
        Add field
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="field name"
        className="h-6 w-28 border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as FieldKind)}
        className="h-6 border border-zinc-800 bg-zinc-900 px-1 text-[10px] text-zinc-300 focus:border-blue-500 focus:outline-none"
      >
        <option value="string">text</option>
        <option value="number">number</option>
        <option value="boolean">bool</option>
        <option value="date">date</option>
        <option value="array">list</option>
        <option value="object">json</option>
      </select>
      <button
        onClick={submit}
        className="h-6 border border-blue-600 bg-blue-600 px-2 text-[10px] font-medium text-white hover:bg-blue-500 transition-colors"
      >
        Add
      </button>
      <button
        onClick={() => setOpen(false)}
        className="h-6 px-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
