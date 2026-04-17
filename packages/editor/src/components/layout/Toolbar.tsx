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
  Code2,
  Sparkles,
} from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useHistoryStore } from "../../store/history-store";
import { useModeStore } from "../../store/mode-store";
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
  const userMode = useModeStore((s) => s.userMode);
  const setUserMode = useModeStore((s) => s.setUserMode);

  return (
    <div className="flex h-12 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3">
      {/* Project name */}
      <span className="text-[11px] font-semibold text-zinc-200 tracking-tight">
        {projectName || "TVE"}
      </span>

      <Divider />

      {/* User mode: Dev / Marketer */}
      <div className="inline-flex items-center gap-0.5 border border-zinc-800 bg-zinc-900 p-0.5 shadow-sm">
        <SegmentButton active={userMode === "dev"} onClick={() => setUserMode("dev")}>
          <Code2 size={11} />
          Dev
        </SegmentButton>
        <SegmentButton active={userMode === "marketer"} onClick={() => setUserMode("marketer")}>
          <Sparkles size={11} />
          Marketer
        </SegmentButton>
      </div>

      <Divider />

      {/* Dev server control */}
      {devServerStatus === "stopped" || devServerStatus === "error" ? (
        <button
          onClick={startDevServer}
          className="inline-flex h-7 items-center gap-1.5  bg-emerald-500 px-2.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-400 transition-colors"
        >
          <Play size={11} />
          Start
        </button>
      ) : devServerStatus === "starting" ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
          <Loader2 size={12} className="animate-spin" />
          Starting...
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping  bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2  bg-emerald-400" />
          </span>
          Running
        </span>
      )}

      <Divider />

      {/* Page selector */}
      <PageSelector />

      <Divider />

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <IconButton
          onClick={() => {
            const entry = useHistoryStore.getState().undo();
            if (entry) applyMutation(entry.inverse, true);
          }}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </IconButton>
        <IconButton
          onClick={() => {
            const entry = useHistoryStore.getState().redo();
            if (entry) applyMutation(entry.mutation, true);
          }}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={13} />
        </IconButton>
      </div>

      <Divider />

      {/* Dev-only: New Component + Design System */}
      {userMode === "dev" && (
        <>
          <button
            onClick={() => setShowNewComponent(true)}
            className="inline-flex h-7 items-center gap-1.5  border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 shadow-sm hover:bg-zinc-800 hover:text-white hover:border-zinc-700 transition-colors"
            title="Create new component"
          >
            <Plus size={11} />
            Component
          </button>

          {showNewComponent && (
            <ComponentDialog mode="create" onClose={() => setShowNewComponent(false)} />
          )}

          <button
            onClick={() => setShowDesignSystem(true)}
            className="inline-flex h-7 items-center gap-1.5  border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 shadow-sm hover:bg-zinc-800 hover:text-white hover:border-zinc-700 transition-colors"
            title="Design System"
          >
            <Palette size={11} />
            Design
          </button>

          {showDesignSystem && (
            <DesignSystemPanel onClose={() => setShowDesignSystem(false)} />
          )}
        </>
      )}

      <div className="flex-1" />

      {/* Mode toggle */}
      <div className="inline-flex items-center gap-0.5  border border-zinc-800 bg-zinc-900 p-0.5 shadow-sm">
        <SegmentButton active={mode === "edit"} onClick={() => setMode("edit")}>
          <Pencil size={11} />
          Edit
        </SegmentButton>
        <SegmentButton active={mode === "preview"} onClick={() => setMode("preview")}>
          <Eye size={11} />
          Preview
        </SegmentButton>
      </div>

      {/* Device presets */}
      <div className="inline-flex items-center gap-0.5  border border-zinc-800 bg-zinc-900 p-0.5 shadow-sm">
        {([
          { key: "desktop" as const, icon: <Monitor size={12} />, label: "Desktop" },
          { key: "tablet" as const, icon: <Tablet size={12} />, label: "Tablet (768px)" },
          { key: "mobile" as const, icon: <Smartphone size={12} />, label: "Mobile (375px)" },
        ]).map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setDevicePreset(key)}
            className={`flex h-6 w-6 items-center justify-center  transition-colors ${
              devicePreset === key
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
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

function Divider() {
  return <div className="mx-1 h-5 w-px bg-zinc-800" />;
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 items-center justify-center  transition-colors ${
        disabled
          ? "text-zinc-700 cursor-not-allowed"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1  px-2 text-[11px] font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-white shadow-sm"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
