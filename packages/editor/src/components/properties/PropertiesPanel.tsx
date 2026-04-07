import { useState } from "react";
import { Paintbrush, LayoutGrid, Type as TypeIcon } from "lucide-react";
import type { ElementInfo } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { TailwindClassEditor } from "./TailwindClassEditor";
import { AttributesPanel } from "./AttributesPanel";
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
  { id: "style", label: "Style", icon: <Paintbrush size={11} /> },
  { id: "layout", label: "Layout", icon: <LayoutGrid size={11} /> },
  { id: "text", label: "Text", icon: <TypeIcon size={11} /> },
];

export function PropertiesPanel({ nodeId, elementInfo }: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("style");
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const nodeMap = useEditorStore((s) => s.nodeMap);

  const astNode = nodeMap.get(nodeId);
  const classes = astNode?.classes ?? elementInfo.classes;
  const attributes = astNode?.attributes ?? elementInfo.attributes;
  const isComponent = astNode?.isComponent || /^[A-Z]/.test(elementInfo.tagName);

  function handleClassesChange(newClasses: string) {
    applyMutation({ type: "update-classes", nodeId, classes: newClasses });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Element header */}
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center  border px-1.5 py-0.5 font-mono text-[11px] font-medium ${
              isComponent
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-blue-500/30 bg-blue-500/10 text-blue-300"
            }`}
          >
            {elementInfo.tagName}
          </span>
          {Object.entries(elementInfo.attributes)
            .slice(0, 2)
            .map(([key, value]) => (
              <span key={key} className="text-[10px] text-zinc-500 font-mono truncate">
                {key}=<span className="text-zinc-400">&quot;{value}&quot;</span>
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
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Classes
        </div>
        <TailwindClassEditor
          nodeId={nodeId}
          classes={classes}
          onClassesChange={handleClassesChange}
        />
      </div>

      {/* Attributes — read/write all non-class attrs */}
      <AttributesPanel nodeId={nodeId} attributes={attributes} />

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-950">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors ${
              activeTab === tab.id
                ? "text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 " />
            )}
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
