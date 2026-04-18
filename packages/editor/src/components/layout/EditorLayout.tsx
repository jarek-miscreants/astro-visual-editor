import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Toolbar } from "./Toolbar";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { IframeCanvas } from "../canvas/IframeCanvas";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { useEditorStore } from "../../store/editor-store";
import { useContentStore } from "../../store/content-store";

export function EditorLayout() {
  const mode = useEditorStore((s) => s.mode);
  const isPreview = mode === "preview";
  const contentPath = useContentStore((s) => s.currentPath);
  const isContent = !!contentPath;

  return (
    <div className="flex h-screen flex-col">
      <Toolbar />
      {isContent ? (
        <div className="flex-1 min-h-0">
          <MarkdownEditor />
        </div>
      ) : isPreview ? (
        <div className="flex-1">
          <IframeCanvas />
        </div>
      ) : (
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel defaultSize={18} minSize={12} maxSize={30}>
            <LeftSidebar />
          </Panel>
          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors" />
          <Panel defaultSize={57} minSize={30}>
            <IframeCanvas />
          </Panel>
          <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors" />
          <Panel defaultSize={25} minSize={15} maxSize={40}>
            <RightSidebar />
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}
