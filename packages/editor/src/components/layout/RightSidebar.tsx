import { MousePointerClick } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { PropertiesPanel } from "../properties/PropertiesPanel";
import { Kbd } from "../ui/Kbd";

export function RightSidebar() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedElementInfo = useEditorStore((s) => s.selectedElementInfo);
  const userMode = useModeStore((s) => s.userMode);

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
          <PropertiesEmptyState userMode={userMode} />
        )}
      </div>
    </div>
  );
}

function PropertiesEmptyState({ userMode }: { userMode: "dev" | "marketer" }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
        <MousePointerClick size={16} />
      </div>
      <div>
        <div className="text-[12px] font-medium text-zinc-300">Nothing selected</div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Click an element in the preview or the tree to edit its properties.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-600">
        Press <Kbd>?</Kbd> for shortcuts
      </div>
      {userMode === "marketer" && (
        <p className="mt-2 max-w-[220px] text-[10px] leading-relaxed text-zinc-600">
          You're in <span className="font-semibold text-emerald-300">Marketer</span> mode —
          editing is scoped to copy and props.
        </p>
      )}
    </div>
  );
}
