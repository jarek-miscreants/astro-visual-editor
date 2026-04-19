import { useEffect, useState } from "react";
import { Sparkles, Code2, ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentPropSchema, ComponentPropField } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { api } from "../../lib/api-client";

interface Props {
  nodeId: string;
  tagName: string;
  attributes: Record<string, string>;
}

/** Prop names that almost always hold user-facing copy. */
const CONTENT_NAME_RE =
  /^(title|heading|headline|subtitle|subheading|description|body|text|content|label|cta|caption|excerpt|quote|author|eyebrow|message)$/i;

/** A value looks like prose when it reads like a sentence: spaces + length, or sentence punctuation. */
function looksLikeProse(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length >= 30 && /\s/.test(trimmed)) return true;
  if (/[.!?,:;]/.test(trimmed) && /\s/.test(trimmed)) return true;
  return false;
}

function isContentField(field: ComponentPropField, currentValue: string | undefined): boolean {
  if (field.kind !== "string" && field.kind !== "unknown") return false;
  if (CONTENT_NAME_RE.test(field.name)) return true;
  if (looksLikeProse(currentValue)) return true;
  if (looksLikeProse(field.kind === "string" ? field.default : undefined)) return true;
  return false;
}

/** Synthesise a schema from the element's own attributes when the component has no Props interface. */
function deriveSchemaFromAttributes(attributes: Record<string, string>): ComponentPropField[] {
  const fields: ComponentPropField[] = [];
  for (const [name] of Object.entries(attributes)) {
    if (name === "class" || name === "className") continue;
    fields.push({ kind: "string", name, required: false });
  }
  return fields;
}

/**
 * Typed editor for a component's Props. Shows a dropdown/toggle/input per
 * declared prop, falling back to the generic AttributesPanel for anything the
 * parser can't classify (returned as kind: "unknown").
 */
export function ComponentPropsPanel({ nodeId, tagName, attributes }: Props) {
  const files = useEditorStore((s) => s.files);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const [schema, setSchema] = useState<ComponentPropSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Locate the component's source file by matching the tagName to a .astro filename
  const componentFile = files.find(
    (f) => f.type === "component" && f.path.endsWith(`/${tagName}.astro`)
  );

  useEffect(() => {
    if (!componentFile) {
      setSchema(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getComponentProps(componentFile.path)
      .then((s) => {
        if (!cancelled) setSchema(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [componentFile?.path]);

  if (loading) {
    return (
      <div className="border-b border-zinc-800 px-3 py-2.5 text-[10px] text-zinc-500">
        Loading props…
      </div>
    );
  }
  if (error) {
    return (
      <div className="border-b border-zinc-800 px-3 py-2.5 text-[10px] text-red-400">
        {error}
      </div>
    );
  }

  // Schema from the component's Props interface takes priority. If none exists
  // (or the component file isn't resolvable from tagName), fall back to
  // auto-exposing the element's current string attributes.
  const fields =
    schema && schema.fields.length > 0
      ? schema.fields
      : deriveSchemaFromAttributes(attributes);
  if (fields.length === 0) return null;

  const contentFields: ComponentPropField[] = [];
  const advancedFields: ComponentPropField[] = [];
  for (const f of fields) {
    if (isContentField(f, attributes[f.name])) contentFields.push(f);
    else advancedFields.push(f);
  }

  function commit(attr: string, value: string | null) {
    applyMutation({ type: "update-attribute", nodeId, attr, value });
  }

  return (
    <>
      {contentFields.length > 0 && (
        <div className="border-b border-zinc-800 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <Sparkles size={11} className="text-emerald-400" />
            Content
          </div>
          <div className="space-y-3">
            {contentFields.map((field) => (
              <PropField
                key={field.name}
                field={field}
                currentValue={attributes[field.name]}
                onChange={(v) => commit(field.name, v)}
                prominent
              />
            ))}
          </div>
        </div>
      )}
      {advancedFields.length > 0 && (
        <AdvancedSection
          fields={advancedFields}
          attributes={attributes}
          onChange={commit}
          defaultOpen={contentFields.length === 0}
        />
      )}
    </>
  );
}

function AdvancedSection({
  fields,
  attributes,
  onChange,
  defaultOpen,
}: {
  fields: ComponentPropField[];
  attributes: Record<string, string>;
  onChange: (attr: string, value: string | null) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Advanced
        <span className="ml-1 text-zinc-600 font-normal normal-case tracking-normal">
          ({fields.length})
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {fields.map((field) => (
            <PropField
              key={field.name}
              field={field}
              currentValue={attributes[field.name]}
              onChange={(v) => onChange(field.name, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PropField({
  field,
  currentValue,
  onChange,
  prominent = false,
}: {
  field: ComponentPropField;
  currentValue: string | undefined;
  onChange: (value: string | null) => void;
  prominent?: boolean;
}) {
  const isExpression =
    typeof currentValue === "string" &&
    currentValue.startsWith("{") &&
    currentValue.endsWith("}");

  if (prominent) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-300 capitalize">
          {field.name}
          {field.required && <span className="ml-0.5 text-red-400">*</span>}
        </label>
        {isExpression ? (
          <div
            className="flex items-center gap-1 border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 font-mono text-[10px] text-amber-400/80"
            title="Astro expression — edit in source"
          >
            <Code2 size={10} />
            <span className="truncate">{currentValue}</span>
          </div>
        ) : (
          <PropControl field={field} value={currentValue} onChange={onChange} prominent />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <label className="w-20 shrink-0 pt-1 font-mono text-[10px] text-zinc-400">
        {field.name}
        {field.required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      <div className="min-w-0 flex-1">
        {isExpression ? (
          <div
            className="flex items-center gap-1 border border-zinc-800 bg-zinc-900/50 px-1.5 py-1 font-mono text-[10px] text-amber-400/80"
            title="Astro expression — edit in source"
          >
            <Code2 size={10} />
            <span className="truncate">{currentValue}</span>
          </div>
        ) : (
          <PropControl field={field} value={currentValue} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function PropControl({
  field,
  value,
  onChange,
  prominent = false,
}: {
  field: ComponentPropField;
  value: string | undefined;
  onChange: (value: string | null) => void;
  prominent?: boolean;
}) {
  if (field.kind === "enum") {
    const current = value ?? field.default ?? "";
    return (
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500"
      >
        {!field.required && !field.default && (
          <option value="">— unset —</option>
        )}
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
            {field.default === opt ? " (default)" : ""}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === "boolean") {
    const checked = value === "" || value === "true" || value === field.name;
    return (
      <label className="inline-flex items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? "" : null)}
          className="h-3.5 w-3.5 accent-blue-500"
        />
        <span className="text-zinc-500 font-mono">
          {checked ? "true" : "false"}
          {field.default !== undefined && (
            <span className="ml-1 text-[9px] text-zinc-600">
              (default: {String(field.default)})
            </span>
          )}
        </span>
      </label>
    );
  }

  if (field.kind === "number") {
    return (
      <input
        type="number"
        defaultValue={value ?? (field.default !== undefined ? String(field.default) : "")}
        placeholder={field.default !== undefined ? String(field.default) : "number"}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== (value ?? "")) onChange(v === "" ? null : v);
        }}
        className="w-full border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500"
      />
    );
  }

  if (field.kind === "string") {
    if (prominent) {
      return (
        <textarea
          key={value ?? "__empty__"}
          defaultValue={value ?? ""}
          placeholder={field.default ?? ""}
          rows={Math.min(6, Math.max(2, Math.ceil((value?.length ?? 0) / 48)))}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (value ?? "")) onChange(v === "" ? null : v);
          }}
          className="w-full resize-y border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-blue-500 placeholder:text-zinc-600"
        />
      );
    }
    return (
      <input
        type="text"
        defaultValue={value ?? ""}
        placeholder={field.default ?? "string"}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== (value ?? "")) onChange(v === "" ? null : v);
        }}
        className="w-full border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500"
      />
    );
  }

  // Unknown type — fall back to free-form text
  if (prominent) {
    return (
      <textarea
        key={value ?? "__empty__"}
        defaultValue={value ?? ""}
        placeholder={field.typeText || ""}
        rows={Math.min(6, Math.max(2, Math.ceil((value?.length ?? 0) / 48)))}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== (value ?? "")) onChange(v === "" ? null : v);
        }}
        className="w-full resize-y border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-blue-500 placeholder:text-zinc-600"
        title={`Type: ${field.typeText}`}
      />
    );
  }
  return (
    <input
      type="text"
      defaultValue={value ?? ""}
      placeholder={field.typeText || "value"}
      onBlur={(e) => {
        const v = e.target.value;
        if (v !== (value ?? "")) onChange(v === "" ? null : v);
      }}
      className="w-full border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500"
      title={`Type: ${field.typeText}`}
    />
  );
}
