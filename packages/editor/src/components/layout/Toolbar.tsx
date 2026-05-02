import { useState } from "react";
import {
  Play,
  Monitor,
  Tablet,
  Smartphone,
  Eye,
  Pencil,
  Loader2,
  Undo2,
  Redo2,
  Plus,
  FilePlus2,
  Palette,
  Code2,
  Sparkles,
  FolderOpen,
  Keyboard,
} from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useHistoryStore } from "../../store/history-store";
import { useModeStore } from "../../store/mode-store";
import { PageSelector } from "../page-selector/PageSelector";
import { ComponentDialog } from "../dialogs/ComponentDialog";
import { PageDialog } from "../dialogs/PageDialog";
import { ProjectPickerDialog } from "../dialogs/ProjectPickerDialog";
import { DesignSystemPanel } from "../design-system/DesignSystemPanel";
import { Tooltip } from "../ui/Tooltip";
import { openShortcutsDialog } from "../ui/ShortcutsDialog";
import { GitToolbarWidget } from "../git/GitToolbarWidget";

export function Toolbar() {
  const [showNewComponent, setShowNewComponent] = useState(false);
  const [showNewPage, setShowNewPage] = useState(false);
  const [showDesignSystem, setShowDesignSystem] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
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
  const resetProject = useEditorStore((s) => s.resetProject);
  const initProject = useEditorStore((s) => s.initProject);
  const userMode = useModeStore((s) => s.userMode);
  const setUserMode = useModeStore((s) => s.setUserMode);

  async function handleProjectSwitched() {
    setShowProjectPicker(false);
    resetProject();
    await initProject();
  }

  return (
    <div className="tve-toolbar">
      {/* Project name — click to switch project */}
      <Tooltip content="Open another project">
        <button
          onClick={() => setShowProjectPicker(true)}
          className="tve-toolbar__brand"
        >
          <FolderOpen size={11} className="tve-toolbar__brand-icon" />
          {projectName || "Open project…"}
        </button>
      </Tooltip>

      {showProjectPicker && (
        <ProjectPickerDialog
          onClose={() => setShowProjectPicker(false)}
          onSwitched={handleProjectSwitched}
        />
      )}

      <Divider />

      {/* User mode: Dev / Marketer */}
      <div className="tve-segment">
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
        <button onClick={startDevServer} className="tve-button-primary">
          <Play size={11} />
          Start
        </button>
      ) : devServerStatus === "starting" ? (
        <span className="tve-status tve-status--starting">
          <Loader2 size={12} className="animate-spin" />
          Starting...
        </span>
      ) : (
        <span className="tve-status tve-status--running">
          <span className="tve-status__dot">
            <span className="tve-status__dot-ping" />
            <span className="tve-status__dot-core" />
          </span>
          Running
        </span>
      )}

      <Divider />

      {/* Page selector */}
      <PageSelector />

      <Divider />

      {/* Git widget — hidden when project isn't a repo */}
      <GitToolbarWidget />

      <Divider />

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <Tooltip content="Undo" shortcut="Ctrl+Z">
          <IconButton
            onClick={() => {
              const entry = useHistoryStore.getState().undo();
              if (entry) applyMutation(entry.inverse, true);
            }}
            disabled={!canUndo}
          >
            <Undo2 size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Redo" shortcut="Ctrl+Shift+Z">
          <IconButton
            onClick={() => {
              const entry = useHistoryStore.getState().redo();
              if (entry) applyMutation(entry.mutation, true);
            }}
            disabled={!canRedo}
          >
            <Redo2 size={13} />
          </IconButton>
        </Tooltip>
      </div>

      <Divider />

      {/* Dev-only: New Page + New Component + Design System */}
      {userMode === "dev" && (
        <>
          <Tooltip content="Create new static page">
            <button onClick={() => setShowNewPage(true)} className="tve-button-secondary">
              <FilePlus2 size={11} />
              Page
            </button>
          </Tooltip>

          {showNewPage && <PageDialog onClose={() => setShowNewPage(false)} />}

          <Tooltip content="Create new component">
            <button onClick={() => setShowNewComponent(true)} className="tve-button-secondary">
              <Plus size={11} />
              Component
            </button>
          </Tooltip>

          {showNewComponent && (
            <ComponentDialog mode="create" onClose={() => setShowNewComponent(false)} />
          )}

          <Tooltip content="Design system tokens">
            <button onClick={() => setShowDesignSystem(true)} className="tve-button-secondary">
              <Palette size={11} />
              Design
            </button>
          </Tooltip>

          {showDesignSystem && (
            <DesignSystemPanel onClose={() => setShowDesignSystem(false)} />
          )}
        </>
      )}

      <div className="tve-toolbar__spacer" />

      {/* Keyboard shortcuts */}
      <Tooltip content="Keyboard shortcuts" shortcut="?">
        <IconButton onClick={openShortcutsDialog}>
          <Keyboard size={13} />
        </IconButton>
      </Tooltip>

      {/* Mode toggle */}
      <div className="tve-segment">
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
      <div className="tve-segment">
        {([
          { key: "desktop" as const, icon: <Monitor size={12} />, label: "Desktop" },
          { key: "tablet" as const, icon: <Tablet size={12} />, label: "Tablet (768px)" },
          { key: "mobile" as const, icon: <Smartphone size={12} />, label: "Mobile (375px)" },
        ]).map(({ key, icon, label }) => (
          <Tooltip key={key} content={label}>
            <button
              onClick={() => setDevicePreset(key)}
              className="tve-segment__btn tve-segment__btn--icon"
              data-active={devicePreset === key || undefined}
            >
              {icon}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="tve-toolbar__divider" />;
}

function IconButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="tve-icon-btn">
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
      className="tve-segment__btn"
      data-active={active || undefined}
    >
      {children}
    </button>
  );
}
