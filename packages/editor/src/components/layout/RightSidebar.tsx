import { useEditorStore } from "../../store/editor-store";
import { PropertiesPanel } from "../properties/PropertiesPanel";

export function RightSidebar() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedElementInfo = useEditorStore((s) => s.selectedElementInfo);

  return (
    <div className="flex h-full flex-col bg-zinc-950 border-l border-zinc-800">
      <div className="flex h-10 items-center border-b border-zinc-800 px-3">
        <span className="text-[11px] font-semibold text-zinc-200 tracking-tight">
          Properties
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        {selectedNodeId && selectedElementInfo ? (
          <PropertiesPanel
            nodeId={selectedNodeId}
            elementInfo={selectedElementInfo}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6">
            <p className="text-xs text-zinc-500 text-center leading-relaxed">
              Select an element<br />to edit its properties
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
