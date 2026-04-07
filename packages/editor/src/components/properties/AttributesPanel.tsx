import { useState } from "react";
import { Plus, X, Code2 } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";

interface AttributesPanelProps {
  nodeId: string;
  attributes: Record<string, string>;
}

/**
 * Lists every attribute on the selected element and lets the user edit, add,
 * or remove them. Class is excluded — it has its own editor above.
 *
 * Attributes whose value is an Astro expression (parser returns them wrapped
 * as `{expr}`) are shown read-only — overwriting them with `update-attribute`
 * would convert the expression to a string literal and corrupt the source.
 */
export function AttributesPanel({ nodeId, attributes }: AttributesPanelProps) {
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const entries = Object.entries(attributes).filter(([k]) => k !== "class");

  function commitValue(attr: string, value: string) {
    applyMutation({ type: "update-attribute", nodeId, attr, value });
  }

  function removeAttr(attr: string) {
    applyMutation({ type: "update-attribute", nodeId, attr, value: null });
  }

  function addDraft() {
    const key = draftKey.trim();
    if (!key) return;
    applyMutation({ type: "update-attribute", nodeId, attr: key, value: draftValue });
    setDraftKey("");
    setDraftValue("");
  }

  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <div className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
        Attributes
      </div>

      {entries.length === 0 && (
        <div className="mb-2 text-[11px] text-zinc-600 italic">No attributes</div>
      )}

      <div className="space-y-1">
        {entries.map(([key, value]) => {
          const isExpression = value.startsWith("{") && value.endsWith("}");
          return (
            <div key={key} className="flex items-center gap-1">
              <span className="w-20 shrink-0 truncate font-mono text-[10px] text-zinc-400">
                {key}
              </span>
              {isExpression ? (
                <div
                  className="flex flex-1 items-center gap-1 border border-zinc-800 bg-zinc-900/50 px-1.5 py-1 font-mono text-[10px] text-amber-400/80"
                  title="Astro expression — edit in source"
                >
                  <Code2 size={10} />
                  <span className="truncate">{value}</span>
                </div>
              ) : (
                <input
                  defaultValue={value}
                  onBlur={(e) => {
                    if (e.target.value !== value) commitValue(key, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="flex-1 border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500"
                />
              )}
              <button
                onClick={() => removeAttr(key)}
                className="p-1 text-zinc-600 hover:text-red-400"
                title="Remove attribute"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add new */}
      <div className="mt-2 flex items-center gap-1">
        <input
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder="name"
          className="w-20 shrink-0 border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500"
        />
        <input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addDraft();
          }}
          placeholder="value"
          className="flex-1 border border-zinc-800 bg-zinc-900 px-1.5 py-1 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500"
        />
        <button
          onClick={addDraft}
          disabled={!draftKey.trim()}
          className="p-1 text-zinc-500 hover:text-blue-400 disabled:opacity-30"
          title="Add attribute"
        >
          <Plus size={11} />
        </button>
      </div>
    </div>
  );
}
