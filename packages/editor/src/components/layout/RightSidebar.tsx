import { useEffect, useState } from "react";
import { Globe2, MousePointerClick, SlidersHorizontal } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { PropertiesPanel } from "../properties/PropertiesPanel";
import { SeoPanel } from "../seo/SeoPanel";
import { Kbd } from "../ui/Kbd";

type RightSidebarTab = "properties" | "seo";

export function RightSidebar() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedElementInfo = useEditorStore((s) => s.selectedElementInfo);
  const currentFile = useEditorStore((s) => s.currentFile);
  const userMode = useModeStore((s) => s.userMode);
  const [activeTab, setActiveTab] = useState<RightSidebarTab>("properties");
  const isPage =
    !!currentFile &&
    currentFile.startsWith("src/pages/") &&
    currentFile.endsWith(".astro");

  useEffect(() => {
    if (!isPage && activeTab === "seo") setActiveTab("properties");
  }, [activeTab, isPage]);

  return (
    <div className="tve-panel tve-panel--right">
      <div className="tve-panel__header">
        <span className="tve-panel__title">
          {activeTab === "seo" ? "SEO / Social" : "Properties"}
        </span>
        {isPage && (
          <div className="tve-segment tve-panel-tabs" aria-label="Right sidebar">
            <button
              type="button"
              className="tve-segment__btn tve-segment__btn--icon"
              data-active={activeTab === "properties"}
              onClick={() => setActiveTab("properties")}
              title="Properties"
            >
              <SlidersHorizontal size={12} />
            </button>
            <button
              type="button"
              className="tve-segment__btn tve-segment__btn--icon"
              data-active={activeTab === "seo"}
              onClick={() => setActiveTab("seo")}
              title="SEO"
            >
              <Globe2 size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="tve-panel__body">
        {activeTab === "seo" ? (
          <SeoPanel />
        ) : selectedNodeId && selectedElementInfo ? (
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
