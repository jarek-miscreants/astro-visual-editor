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
    <div className="tve-panel tve-panel--right">
      <div className="tve-panel__header">
        <span className="tve-panel__title">Properties</span>
      </div>
      <div className="tve-panel__body">
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
    <div className="tve-empty">
      <div className="tve-empty__icon">
        <MousePointerClick size={16} />
      </div>
      <div>
        <div className="tve-empty__title">Nothing selected</div>
        <p className="tve-empty__desc">
          Click an element in the preview or the tree to edit its properties.
        </p>
      </div>
      <div className="tve-empty__hint">
        Press <Kbd>?</Kbd> for shortcuts
      </div>
      {userMode === "marketer" && (
        <p className="tve-empty__note">
          You're in <span className="font-semibold text-emerald-300">Marketer</span> mode —
          editing is scoped to copy and props.
        </p>
      )}
    </div>
  );
}
