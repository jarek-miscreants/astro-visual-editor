import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Save,
  Loader2,
  AlertTriangle,
  Code2,
  Wand2,
  Columns2,
  Image as ImageIcon,
  Trash2,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useContentStore } from "../../store/content-store";
import { FrontmatterForm } from "./FrontmatterForm";
import { RichBodyEditor } from "./RichBodyEditor";
import { ImagePickerDialog } from "../dialogs/ImagePickerDialog";
import { projectAssetPreviewUrl } from "../../lib/api-client";

type Mode = "source" | "rich" | "split";
const MODE_KEY = "tve:markdown-mode";
const AUTOSAVE_KEY = "tve:markdown-autosave";
const AUTOSAVE_DELAY_MS = 1200;

function loadMode(): Mode {
  const v = typeof window !== "undefined" ? localStorage.getItem(MODE_KEY) : null;
  return v === "rich" || v === "split" ? v : "source";
}

function loadAutosave(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(AUTOSAVE_KEY) === "1";
}

export function MarkdownEditor() {
  const current = useContentStore((s) => s.current);
  const currentPath = useContentStore((s) => s.currentPath);
  const dirty = useContentStore((s) => s.dirty);
  const saving = useContentStore((s) => s.saving);
  const deleting = useContentStore((s) => s.deleting);
  const lastError = useContentStore((s) => s.lastError);
  const revision = useContentStore((s) => s.revision);
  const updateBody = useContentStore((s) => s.updateBody);
  const save = useContentStore((s) => s.save);
  const deleteFile = useContentStore((s) => s.deleteFile);

  const [mode, setModeState] = useState<Mode>(loadMode);
  const [autosave, setAutosaveState] = useState(loadAutosave);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [bodySelection, setBodySelection] = useState<{ start: number; end: number } | null>(null);
  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  };
  const setAutosave = (enabled: boolean) => {
    setAutosaveState(enabled);
    localStorage.setItem(AUTOSAVE_KEY, enabled ? "1" : "0");
  };

  function insertBodyImage(url: string) {
    if (!current) return;

    const imageMarkdown = `![Image](${url})`;
    const selection = bodySelection ?? {
      start: current.body.length,
      end: current.body.length,
    };
    const before = current.body.slice(0, selection.start);
    const after = current.body.slice(selection.end);
    const prefix = before.length === 0 || before.endsWith("\n") ? "" : "\n\n";
    const suffix = after.length === 0 || after.startsWith("\n") ? "" : "\n\n";

    updateBody(`${before}${prefix}${imageMarkdown}${suffix}${after}`);
    const cursor = selection.start + prefix.length + imageMarkdown.length;
    setBodySelection({ start: cursor, end: cursor });
  }

  async function handleDelete() {
    if (!currentPath || deleting) return;
    const dirtyWarning = dirty ? "\n\nUnsaved changes in this entry will be lost." : "";
    const confirmed = window.confirm(
      `Delete ${currentPath}?\n\nThis removes the content file from disk.${dirtyWarning}`
    );
    if (!confirmed) return;

    try {
      await deleteFile(currentPath);
    } catch {
      // The store surfaces the error in the header.
    }
  }

  // Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

  useEffect(() => {
    if (!autosave || !currentPath || !dirty || saving) return;

    const timeout = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [autosave, currentPath, dirty, saving, revision, save]);

  if (!currentPath) return null;

  if (!current) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-500">
        {lastError ? (
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={14} />
            {lastError}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading {currentPath}…
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
          <span className="text-zinc-500">{current.format}</span>
          <span>{currentPath}</span>
          {dirty && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          <AutosaveToggle enabled={autosave} onChange={setAutosave} />
          {mode !== "rich" && (
            <button
              onClick={() => setImagePickerOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 border border-zinc-800 bg-zinc-950 px-2 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              title="Insert image from library"
            >
              <ImageIcon size={11} />
              Image
            </button>
          )}
          {lastError && (
            <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
              <AlertTriangle size={11} />
              {lastError}
            </span>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting || saving}
            className={`inline-flex h-7 items-center gap-1.5 border px-2 text-xs font-medium transition-colors ${
              deleting || saving
                ? "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600"
                : "border-red-900/70 bg-zinc-950 text-red-300 hover:border-red-700 hover:bg-red-950/40 hover:text-red-200"
            }`}
            title="Delete content entry"
          >
            {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button
            onClick={() => save()}
            disabled={!dirty || saving}
            className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors ${
              !dirty || saving
                ? "cursor-not-allowed bg-zinc-900 text-zinc-600"
                : "bg-emerald-500 text-white hover:bg-emerald-400"
            }`}
            title="Save (Ctrl+S)"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>

      <FrontmatterForm />

      <div className="flex-1 min-h-0">
        {mode === "source" && (
          <BodyEditor
            body={current.body}
            onChange={updateBody}
            onSelectionChange={setBodySelection}
          />
        )}
        {mode === "rich" && (
          <RichBodyEditor body={current.body} onChange={updateBody} />
        )}
        {mode === "split" && (
          <PanelGroup direction="horizontal">
            <Panel defaultSize={50} minSize={25}>
              <BodyEditor
                body={current.body}
                onChange={updateBody}
                onSelectionChange={setBodySelection}
              />
            </Panel>
            <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors" />
            <Panel defaultSize={50} minSize={25}>
              <BodyPreview body={current.body} />
            </Panel>
          </PanelGroup>
        )}
      </div>

      {imagePickerOpen && (
        <ImagePickerDialog
          onSelect={insertBodyImage}
          onClose={() => setImagePickerOpen(false)}
        />
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const base =
    "inline-flex h-7 items-center gap-1 px-2 text-[11px] font-medium transition-colors";
  const active = "bg-zinc-800 text-zinc-100";
  const idle = "bg-zinc-950 text-zinc-500 hover:text-zinc-200";
  return (
    <div className="flex items-center border border-zinc-800">
      <button
        onClick={() => onChange("source")}
        className={`${base} ${mode === "source" ? active : idle}`}
        title="Markdown source"
      >
        <Code2 size={11} /> Source
      </button>
      <button
        onClick={() => onChange("rich")}
        className={`${base} ${mode === "rich" ? active : idle}`}
        title="Rich text editor"
      >
        <Wand2 size={11} /> Rich
      </button>
      <button
        onClick={() => onChange("split")}
        className={`${base} ${mode === "split" ? active : idle}`}
        title="Split view: source + preview"
      >
        <Columns2 size={11} /> Split
      </button>
    </div>
  );
}

function AutosaveToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 border px-2 text-[11px] font-medium transition-colors ${
        enabled
          ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
          : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200"
      }`}
      title="Autosave markdown changes"
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span>Autosave</span>
      <span
        className={`flex h-3.5 w-6 items-center border transition-colors ${
          enabled ? "border-emerald-500 bg-emerald-500" : "border-zinc-700 bg-zinc-900"
        }`}
        aria-hidden="true"
      >
        <span
          className={`h-2.5 w-2.5 bg-white transition-transform ${
            enabled ? "translate-x-3" : "translate-x-0.5"
          }`}
        />
      </span>
    </label>
  );
}

function BodyEditor({
  body,
  onChange,
  onSelectionChange,
}: {
  body: string;
  onChange: (s: string) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function reportSelection() {
    const el = ref.current;
    if (!el) return;
    onSelectionChange({
      start: el.selectionStart,
      end: el.selectionEnd,
    });
  }

  return (
    <div className="flex h-full flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-8 shrink-0 items-center border-b border-zinc-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Body
      </div>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onSelect={reportSelection}
        onClick={reportSelection}
        onKeyUp={reportSelection}
        onFocus={reportSelection}
        spellCheck={false}
        className="flex-1 resize-none bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-zinc-200 focus:outline-none"
      />
    </div>
  );
}

function BodyPreview({ body }: { body: string }) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex h-8 shrink-0 items-center border-b border-zinc-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Preview
      </div>
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="markdown-preview max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img({ src, alt, title }) {
                return (
                  <img
                    src={projectAssetPreviewUrl(src ?? "")}
                    alt={alt ?? ""}
                    title={title}
                  />
                );
              },
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
