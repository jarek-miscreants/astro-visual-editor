import { useState } from "react";
import { Plus, X, Code2 } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";

interface AttributesPanelProps {
  nodeId: string;
  attributes: Record<string, string>;
  /** Override the section title (default: "Attributes"). Used when this panel
   *  is rendered inside Advanced to show the leftover debug attrs. */
  title?: string;
  /** Hide the section's own border + header chrome — useful when nested
   *  inside another collapsible (Advanced) so we don't double-up dividers. */
  embedded?: boolean;
}

/**
 * Lists every attribute on the selected element and lets the user edit, add,
 * or remove them. Class is excluded — it has its own editor above.
 *
 * Attributes whose value is an Astro expression (parser returns them wrapped
 * as `{expr}`) are shown read-only — overwriting them with `update-attribute`
 * would convert the expression to a string literal and corrupt the source.
 */
export function AttributesPanel({ nodeId, attributes, title = "Attributes", embedded = false }: AttributesPanelProps) {
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

  const Wrapper = embedded ? "div" : "div";
  const wrapperClass = embedded ? "" : "tve-prop-section";

  return (
    <Wrapper className={wrapperClass}>
      {!embedded && <div className="tve-prop-section__header">{title}</div>}
      {embedded && <div className="tve-prop-section__header" style={{ marginTop: 8 }}>{title}</div>}

      {entries.length === 0 && (
        <div className="tve-prop-section__empty">No attributes</div>
      )}

      <div className="tve-prop-stack--xs">
        {entries.map(([key, value]) => {
          const isExpression = value.startsWith("{") && value.endsWith("}");
          return (
            <div key={key} className="tve-prop-row">
              <span className="tve-prop-field-row__label" style={{ paddingTop: 0 }}>
                {key}
              </span>
              {isExpression ? (
                <div className="tve-prop-expr" style={{ flex: 1 }} title="Astro expression — edit in source">
                  <Code2 size={10} />
                  <span className="tve-prop-expr__text">{value}</span>
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
                  className="tve-prop-input tve-prop-input--mono"
                  style={{ flex: 1 }}
                />
              )}
              <button
                onClick={() => removeAttr(key)}
                className="tve-prop-icon-action tve-prop-icon-action--danger"
                title="Remove attribute"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add new */}
      <div className="tve-prop-row" style={{ marginTop: 8 }}>
        <input
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder="name"
          className="tve-prop-input tve-prop-input--mono"
          style={{ width: 80, flexShrink: 0 }}
        />
        <input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addDraft();
          }}
          placeholder="value"
          className="tve-prop-input tve-prop-input--mono"
          style={{ flex: 1 }}
        />
        <button
          onClick={addDraft}
          disabled={!draftKey.trim()}
          className="tve-prop-icon-action tve-prop-icon-action--add"
          title="Add attribute"
        >
          <Plus size={11} />
        </button>
      </div>
    </Wrapper>
  );
}

/** Astro injects these attributes for HMR / dev tooling. They're noise in
 *  the user-facing Attributes section, but we still expose them under
 *  Advanced so power users can confirm what's there. */
export function isDebugAttribute(key: string): boolean {
  return key.startsWith("data-astro-");
}

export function splitAttributes(
  attributes: Record<string, string>
): { user: Record<string, string>; debug: Record<string, string> } {
  const user: Record<string, string> = {};
  const debug: Record<string, string> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (isDebugAttribute(k)) debug[k] = v;
    else user[k] = v;
  }
  return { user, debug };
}
