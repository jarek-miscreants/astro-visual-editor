import { useState } from "react";
import { Paintbrush, LayoutGrid, Type as TypeIcon } from "lucide-react";
import type { ElementInfo } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { TailwindClassEditor } from "./TailwindClassEditor";
import { TokenSuggestions } from "./TokenSuggestions";
import { StyleTab } from "./StyleTab";
import { LayoutTab } from "./LayoutTab";
import { TextTab } from "./TextTab";

interface PropertiesPanelProps {
  nodeId: string;
  elementInfo: ElementInfo;
}

type TabId = "style" | "layout" | "text";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "style", label: "Style", icon: <Paintbrush size={12} /> },
  { id: "layout", label: "Layout", icon: <LayoutGrid size={12} /> },
  { id: "text", label: "Text", icon: <TypeIcon size={12} /> },
];

export function PropertiesPanel({ nodeId, elementInfo }: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("style");
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const nodeMap = useEditorStore((s) => s.nodeMap);

  const astNode = nodeMap.get(nodeId);
  const classes = astNode?.classes ?? elementInfo.classes;

  function handleClassesChange(newClasses: string) {
    applyMutation({ type: "update-classes", nodeId, classes: newClasses });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Element header */}
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-blue-400">
            {elementInfo.tagName}
          </span>
          {Object.entries(elementInfo.attributes)
            .slice(0, 2)
            .map(([key, value]) => (
              <span key={key} className="text-[10px] text-zinc-500">
                {key}=&quot;{value}&quot;
              </span>
            ))}
        </div>
      </div>

      {/* Token suggestions */}
      <TokenSuggestions
        tagName={elementInfo.tagName}
        classes={classes}
        onClassesChange={handleClassesChange}
      />

      {/* Classes — always visible at top */}
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="mb-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Classes
        </div>
        <TailwindClassEditor
          nodeId={nodeId}
          classes={classes}
          onClassesChange={handleClassesChange}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors ${
              activeTab === tab.id
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "style" && (
          <StyleTab classes={classes} onClassesChange={handleClassesChange} />
        )}
        {activeTab === "layout" && (
          <LayoutTab classes={classes} onClassesChange={handleClassesChange} />
        )}
        {activeTab === "text" && (
          <TextTab
            nodeId={nodeId}
            classes={classes}
            textContent={astNode?.textContent ?? elementInfo.textContent}
            onClassesChange={handleClassesChange}
            onTextChange={(text) => {
              applyMutation({ type: "update-text", nodeId, text });
            }}
          />
        )}
      </div>
    </div>
  );
}
