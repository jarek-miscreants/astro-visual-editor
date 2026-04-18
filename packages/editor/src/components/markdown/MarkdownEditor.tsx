import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Save, Loader2, AlertTriangle, Code2, Wand2, Columns2 } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useContentStore } from "../../store/content-store";
import { FrontmatterForm } from "./FrontmatterForm";
import { RichBodyEditor } from "./RichBodyEditor";

type Mode = "source" | "rich" | "split";
const MODE_KEY = "tve:markdown-mode";

function loadMode(): Mode {
  const v = typeof window !== "undefined" ? localStorage.getItem(MODE_KEY) : null;
  return v === "rich" || v === "split" ? v : "source";
}

export function MarkdownEditor() {
  const current = useContentStore((s) => s.current);
  const currentPath = useContentStore((s) => s.currentPath);
  const dirty = useContentStore((s) => s.dirty);
  const saving = useContentStore((s) => s.saving);
  const lastError = useContentStore((s) => s.lastError);
  const updateBody = useContentStore((s) => s.updateBody);
  const save = useContentStore((s) => s.save);

  const [mode, setModeState] = useState<Mode>(loadMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  };

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
          {lastError && (
            <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
              <AlertTriangle size={11} />
              {lastError}
            </span>
          )}
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
          <BodyEditor body={current.body} onChange={updateBody} />
        )}
        {mode === "rich" && (
          <RichBodyEditor body={current.body} onChange={updateBody} />
        )}
        {mode === "split" && (
          <PanelGroup direction="horizontal">
            <Panel defaultSize={50} minSize={25}>
              <BodyEditor body={current.body} onChange={updateBody} />
            </Panel>
            <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors" />
            <Panel defaultSize={50} minSize={25}>
              <BodyPreview body={current.body} />
            </Panel>
          </PanelGroup>
        )}
      </div>
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

function BodyEditor({ body, onChange }: { body: string; onChange: (s: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex h-full flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-8 shrink-0 items-center border-b border-zinc-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Body
      </div>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => onChange(e.target.value)}
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
