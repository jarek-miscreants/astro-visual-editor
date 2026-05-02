import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Toolbar } from "./Toolbar";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { IframeCanvas } from "../canvas/IframeCanvas";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useEditorStore } from "../../store/editor-store";
import { useContentStore } from "../../store/content-store";
import { Toaster } from "../ui/Toaster";
import { ShortcutsDialog, useShortcutsHotkey } from "../ui/ShortcutsDialog";
import { Breadcrumb } from "../properties/Breadcrumb";

export function EditorLayout() {
  const mode = useEditorStore((s) => s.mode);
  const isPreview = mode === "preview";
  const contentPath = useContentStore((s) => s.currentPath);
  const isContent = !!contentPath;
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);

  useShortcutsHotkey();
  return (
    <div className="tve-shell">
      <Toolbar />
      {/* Selection breadcrumb — shown under the toolbar whenever something
          is selected, so it stays visible regardless of which panel/tab the
          user is in. Hidden in markdown-content mode. */}
      {!isContent && selectedNodeId && <Breadcrumb nodeId={selectedNodeId} />}
      {isContent ? (
        <div className="tve-shell__body">
          <MarkdownEditor />
        </div>
      ) : isPreview ? (
        <div className="tve-shell__body">
          <IframeCanvas />
        </div>
      ) : (
        <PanelGroup direction="horizontal" className="tve-shell__body">
          <Panel defaultSize={18} minSize={12} maxSize={30}>
            <LeftSidebar />
          </Panel>
          <PanelResizeHandle className="tve-resize-handle" />
          <Panel defaultSize={57} minSize={30}>
            <IframeCanvas />
          </Panel>
          <PanelResizeHandle className="tve-resize-handle" />
          <Panel defaultSize={25} minSize={15} maxSize={40}>
            <RightSidebar />
          </Panel>
        </PanelGroup>
      )}
      <Toaster />
      <ShortcutsDialog />
    </div>
  );
}
