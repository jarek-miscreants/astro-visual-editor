import { useEffect, useMemo, useState } from "react";
import { Sparkles, Code2, ChevronDown, ChevronRight, Link as LinkIcon } from "lucide-react";
import type { ComponentPropSchema, ComponentPropField, ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { api } from "../../lib/api-client";
import { LinkSection } from "./LinkSection";

interface Props {
  nodeId: string;
  tagName: string;
  attributes: Record<string, string>;
}

/** Prop names that almost always hold user-facing copy. */
const CONTENT_NAME_RE =
  /^(title|heading|headline|subtitle|subheading|description|body|text|content|label|cta|caption|excerpt|quote|author|eyebrow|message)$/i;

/** Prop names that almost always hold a URL or link target. */
const LINK_NAME_RE = /^(href|url|link|to|cta_?url|cta_?href)$/i;

/** Prop names paired with href to control whether the link opens in a new tab. */
const NEW_TAB_NAME_RE = /^(target|new_?tab|external)$/i;

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
  if (LINK_NAME_RE.test(field.name)) return false; // Link fields go to their own section
  if (CONTENT_NAME_RE.test(field.name)) return true;
  if (looksLikeProse(currentValue)) return true;
  if (looksLikeProse(field.kind === "string" ? field.default : undefined)) return true;
  return false;
}

function isLinkField(field: ComponentPropField): boolean {
  if (field.kind !== "string" && field.kind !== "unknown") return false;
  return LINK_NAME_RE.test(field.name);
}

function isNewTabField(field: ComponentPropField): boolean {
  return NEW_TAB_NAME_RE.test(field.name);
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

/** Collect every attribute key seen on any instance of `tagName` in the
 *  page's AST. Used to suggest props for external components (like Icon
 *  from astro-icon) whose Props interface lives in node_modules and isn't
 *  introspectable. The current element's attributes are merged so any keys
 *  it has but other instances don't are still represented. */
function deriveSchemaFromPageUsages(
  ast: ASTNode[] | null,
  tagName: string,
  currentAttributes: Record<string, string>
): ComponentPropField[] {
  const seen = new Set<string>();
  if (ast) {
    function walk(nodes: ASTNode[]) {
      for (const n of nodes) {
        if (n.tagName === tagName) {
          for (const k of Object.keys(n.attributes)) {
            if (k !== "class" && k !== "className") seen.add(k);
          }
        }
        walk(n.children);
      }
    }
    walk(ast);
  }
  for (const k of Object.keys(currentAttributes)) {
    if (k !== "class" && k !== "className") seen.add(k);
  }
  return [...seen].sort().map((name) => ({
    kind: "string" as const,
    name,
    required: false,
  }));
}

/**
 * Typed editor for a component's Props. Shows a dropdown/toggle/input per
 * declared prop, falling back to the generic AttributesPanel for anything the
 * parser can't classify (returned as kind: "unknown").
 */
export function ComponentPropsPanel({ nodeId, tagName, attributes }: Props) {
  const files = useEditorStore((s) => s.files);
  const ast = useEditorStore((s) => s.ast);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const [schema, setSchema] = useState<ComponentPropSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Locate the component's source file by matching the tagName to a .astro filename
  const componentFile = files.find(
    (f) => f.type === "component" && f.path.endsWith(`/${tagName}.astro`)
  );

  // For external components (no .astro file in the project), derive a schema
  // from observed attribute usages elsewhere on the same page. Memoised on
  // the AST identity so we don't re-walk it on every render.
  const usageDerived = useMemo(
    () => deriveSchemaFromPageUsages(ast, tagName, attributes),
    [ast, tagName, attributes]
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

  // Schema priority:
  //   1. The component's introspected Props interface (project components).
  //   2. Attribute keys observed on other instances of this tag in the page
  //      (external components like Icon — at least gives the user a list of
  //      props that other instances are using).
  //   3. The element's own current attributes (last resort).
  // Only use a derived fallback when no project schema was found.
  const fields =
    schema && schema.fields.length > 0
      ? schema.fields
      : usageDerived.length > 0
        ? usageDerived
        : deriveSchemaFromAttributes(attributes);
  if (fields.length === 0) return null;

  const contentFields: ComponentPropField[] = [];
  const linkFields: ComponentPropField[] = [];
  const advancedFields: ComponentPropField[] = [];
  for (const f of fields) {
    if (isLinkField(f)) linkFields.push(f);
    else if (isContentField(f, attributes[f.name])) contentFields.push(f);
    else advancedFields.push(f);
  }

  // Detect a "new tab" companion prop (target, newTab, external) so we can
  // pair it with the primary href via LinkSection's checkbox UX. The companion
  // is removed from Advanced when promoted.
  const newTabField = advancedFields.find(isNewTabField);
  const primaryLinkField = linkFields[0];
  const usePairedLink =
    !!primaryLinkField && !!newTabField && newTabField.name.toLowerCase() === "target";

  if (usePairedLink && newTabField) {
    const idx = advancedFields.indexOf(newTabField);
    if (idx >= 0) advancedFields.splice(idx, 1);
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
                nodeId={nodeId}
                field={field}
                currentValue={attributes[field.name]}
                onChange={(v) => commit(field.name, v)}
                prominent
              />
            ))}
          </div>
        </div>
      )}

      {/* Link section — primary href-style prop with URL/Page toggle. The
          new-tab checkbox is shown only when the component declares a target
          prop (paired link); otherwise it's hidden because setting `target`
          on a component without that prop wouldn't propagate. */}
      {primaryLinkField && (
        <LinkSection
          href={attributes[primaryLinkField.name] ?? ""}
          target={attributes.target}
          rel={attributes.rel}
          onAttrChange={(attr, value) => {
            // The primary field name might not be 'href' literally — translate.
            if (attr === "href") commit(primaryLinkField.name, value);
            else commit(attr, value);
          }}
          label={primaryLinkField.name === "href" ? "Link" : `Link (${primaryLinkField.name})`}
          hideNewTab={!usePairedLink}
        />
      )}
      {/* Any additional link fields beyond the first render as plain inputs */}
      {linkFields.length > 1 && (
        <div className="border-b border-zinc-800 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            <LinkIcon size={11} className="text-blue-400" />
            Other links
          </div>
          <div className="space-y-3">
            {linkFields.slice(1).map((field) => (
              <PropField
                key={field.name}
                nodeId={nodeId}
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
          nodeId={nodeId}
          fields={advancedFields}
          attributes={attributes}
          onChange={commit}
          defaultOpen={contentFields.length === 0 && linkFields.length === 0}
        />
      )}
    </>
  );
}

function AdvancedSection({
  nodeId,
  fields,
  attributes,
  onChange,
  defaultOpen,
}: {
  nodeId: string;
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
              nodeId={nodeId}
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
  nodeId,
  field,
  currentValue,
  onChange,
  prominent = false,
}: {
  nodeId: string;
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
          <PropControl nodeId={nodeId} field={field} value={currentValue} onChange={onChange} prominent />
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
          <PropControl nodeId={nodeId} field={field} value={currentValue} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function PropControl({
  nodeId,
  field,
  value,
  onChange,
  prominent = false,
}: {
  nodeId: string;
  field: ComponentPropField;
  value: string | undefined;
  onChange: (value: string | null) => void;
  prominent?: boolean;
}) {
  // Uncontrolled inputs (defaultValue) ignore later prop changes, so when the
  // user picks a different element React reuses the same DOM input and the
  // text stays stale. Keying by `${nodeId}-${field.name}` forces a remount on
  // selection change so each instance shows its own value. Enum/boolean are
  // controlled and don't need the key.
  const inputKey = `${nodeId}-${field.name}`;

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
        key={inputKey}
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
          key={inputKey}
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
        key={inputKey}
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
        key={inputKey}
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
      key={inputKey}
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
