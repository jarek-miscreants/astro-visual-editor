import { useEditorStore } from "../../store/editor-store";
import { PropertiesPanel } from "../properties/PropertiesPanel";

export function RightSidebar() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedElementInfo = useEditorStore((s) => s.selectedElementInfo);

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      <div className="flex items-center border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
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
          <p className="px-3 py-4 text-xs text-zinc-500 text-center">
            Select an element to edit its properties
          </p>
        )}
      </div>
    </div>
  );
}
