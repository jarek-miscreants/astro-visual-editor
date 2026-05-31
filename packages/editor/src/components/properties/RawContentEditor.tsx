import { useEffect, useRef, useState } from "react";
import { Code2 } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";

interface RawContentEditorProps {
  nodeId: string;
  /** "style" or "script" — drives the label and placeholder copy. */
  tagName: string;
  /** Untrimmed inner body of the block, as parsed from source. Updated when
   *  the file re-parses so external edits aren't clobbered. */
  rawContent: string;
}

/**
 * Dev-mode-only raw editor for the inner text of a `<style>` / `<script>`
 * block. A plain textarea (first cut — CodeMirror is a later enhancement).
 * Saving dispatches a single `update-raw-content` mutation that overwrites
 * only the block's inner range; the opening tag, its directives (is:global,
 * define:vars, lang) and the closing tag are preserved.
 */
export function RawContentEditor({ nodeId, tagName, rawContent }: RawContentEditorProps) {
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const [value, setValue] = useState(rawContent);
  // The last content we know matches disk — either the value we loaded, or
  // the value we just saved. Used to (a) drive the dirty indicator and (b)
  // decide whether an external re-parse should refresh the textarea.
  const baselineRef = useRef(rawContent);

  // Refresh on external change: when the file re-parses (manual save,
  // formatter, undo/redo) the parent passes a new rawContent. Adopt it unless
  // the user has unsaved local edits — never clobber in-progress typing.
  useEffect(() => {
    if (rawContent === baselineRef.current) return; // no external change
    setValue((current) => {
      // User has unsaved edits diverging from the old baseline — keep them.
      if (current !== baselineRef.current) return current;
      return rawContent;
    });
    baselineRef.current = rawContent;
  }, [rawContent]);

  const dirty = value !== baselineRef.current;
  const kind = tagName.toLowerCase() === "style" ? "CSS" : "JavaScript";

  function save() {
    if (!dirty) return;
    applyMutation({ type: "update-raw-content", nodeId, content: value });
    // Optimistically adopt the saved value as the new baseline so the dirty
    // flag clears immediately; the subsequent re-parse confirms it.
    baselineRef.current = value;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="tve-prop-section" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
        <div className="tve-prop-section__header" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Code2 size={12} />
          {`<${tagName.toLowerCase()}> ${kind}`}
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            // Ctrl/Cmd+S saves without leaving the field.
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              save();
            }
          }}
          spellCheck={false}
          placeholder={`Edit this ${kind} block…`}
          className="tve-prop-textarea"
          style={{
            flex: "1 1 auto",
            minHeight: 240,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre",
            overflowWrap: "normal",
            tabSize: 2,
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="tve-prop-section__hint">
            {dirty ? "Unsaved changes" : "Saved"} · ⌘/Ctrl+S or blur to save
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="px-3 py-1 text-[11px] font-medium rounded-none border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-default"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only note shown for a selected style/script node in Marketer mode —
 * raw CSS/JS editing is never exposed there.
 */
export function RawContentMarketerNote({ tagName }: { tagName: string }) {
  return (
    <div className="flex-1 overflow-auto px-4 py-6">
      <div className="tve-prop-section">
        <div className="tve-prop-section__header">{`<${tagName.toLowerCase()}> block`}</div>
        <p className="tve-prop-section__hint">
          Raw {tagName.toLowerCase() === "style" ? "CSS" : "JavaScript"} isn't
          editable in Marketer mode. Switch to Dev mode to edit this block.
        </p>
      </div>
    </div>
  );
}
