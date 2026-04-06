import { useState } from "react";
import {
  Play,
  Square,
  Monitor,
  Tablet,
  Smartphone,
  Eye,
  Pencil,
  Loader2,
  Undo2,
  Redo2,
  Plus,
  Palette,
} from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useHistoryStore } from "../../store/history-store";
import { PageSelector } from "../page-selector/PageSelector";
import { ComponentDialog } from "../dialogs/ComponentDialog";
import { DesignSystemPanel } from "../design-system/DesignSystemPanel";

export function Toolbar() {
  const [showNewComponent, setShowNewComponent] = useState(false);
  const [showDesignSystem, setShowDesignSystem] = useState(false);
  const mode = useEditorStore((s) => s.mode);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const setMode = useEditorStore((s) => s.setMode);
  const devicePreset = useEditorStore((s) => s.devicePreset);
  const setDevicePreset = useEditorStore((s) => s.setDevicePreset);
  const devServerStatus = useEditorStore((s) => s.devServerStatus);
  const startDevServer = useEditorStore((s) => s.startDevServer);
  const projectName = useEditorStore((s) => s.projectName);

  return (
    <div className="flex h-11 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3">
      {/* Project name */}
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
        {projectName || "TVE"}
      </span>

      <div className="mx-1 h-5 w-px bg-zinc-700" />

      {/* Dev server control */}
      {devServerStatus === "stopped" || devServerStatus === "error" ? (
        <button
          onClick={startDevServer}
          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Play size={12} />
          Start
        </button>
      ) : devServerStatus === "starting" ? (
        <span className="flex items-center gap-1.5 text-xs text-yellow-400">
          <Loader2 size={12} className="animate-spin" />
          Starting...
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Square size={10} fill="currentColor" />
          Running
        </span>
      )}

      <div className="mx-1 h-5 w-px bg-zinc-700" />

      {/* Page selector */}
      <PageSelector />

      <div className="mx-1 h-5 w-px bg-zinc-700" />

      {/* Undo/Redo */}
      <button
        onClick={() => {
          const entry = useHistoryStore.getState().undo();
          if (entry) applyMutation(entry.inverse, true);
        }}
        disabled={!canUndo}
        className={`rounded p-1 ${canUndo ? "text-zinc-400 hover:bg-zinc-800 hover:text-white" : "text-zinc-600 cursor-not-allowed"}`}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={() => {
          const entry = useHistoryStore.getState().redo();
          if (entry) applyMutation(entry.mutation, true);
        }}
        disabled={!canRedo}
        className={`rounded p-1 ${canRedo ? "text-zinc-400 hover:bg-zinc-800 hover:text-white" : "text-zinc-600 cursor-not-allowed"}`}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 size={14} />
      </button>

      <div className="mx-1 h-5 w-px bg-zinc-700" />

      {/* New Component */}
      <button
        onClick={() => setShowNewComponent(true)}
        className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
        title="Create new component"
      >
        <Plus size={12} />
        Component
      </button>

      {showNewComponent && (
        <ComponentDialog mode="create" onClose={() => setShowNewComponent(false)} />
      )}

      <button
        onClick={() => setShowDesignSystem(true)}
        className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
        title="Design System"
      >
        <Palette size={12} />
        Design
      </button>

      {showDesignSystem && (
        <DesignSystemPanel onClose={() => setShowDesignSystem(false)} />
      )}

      <div className="flex-1" />

      {/* Mode toggle */}
      <div className="flex rounded-md bg-zinc-800 p-0.5">
        <button
          onClick={() => setMode("edit")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
            mode === "edit"
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Pencil size={12} />
          Edit
        </button>
        <button
          onClick={() => setMode("preview")}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
            mode === "preview"
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Eye size={12} />
          Preview
        </button>
      </div>

      {/* Device presets */}
      <div className="flex items-center gap-0.5 rounded-md bg-zinc-800 p-0.5">
        {([
          { key: "desktop" as const, icon: <Monitor size={13} />, label: "Desktop" },
          { key: "tablet" as const, icon: <Tablet size={13} />, label: "Tablet (768px)" },
          { key: "mobile" as const, icon: <Smartphone size={13} />, label: "Mobile (375px)" },
        ]).map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setDevicePreset(key)}
            className={`rounded p-1 transition-colors ${
              devicePreset === key
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
