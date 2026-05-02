import { useState } from "react";
import { Paintbrush, LayoutGrid, Type as TypeIcon, Sparkles } from "lucide-react";
import type { ElementInfo, ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { TailwindClassEditor } from "./TailwindClassEditor";
import { AttributesPanel } from "./AttributesPanel";
import { ComponentPropsPanel } from "./ComponentPropsPanel";
import { TokenSuggestions } from "./TokenSuggestions";
import { StyleTab } from "./StyleTab";
import { LayoutTab } from "./LayoutTab";
import { TextTab } from "./TextTab";
import { Breadcrumb } from "./Breadcrumb";
import { CollapsibleSection } from "../ui/Collapsible";
import { LinkSection } from "./LinkSection";

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
  const userMode = useModeStore((s) => s.userMode);

  const astNode = nodeMap.get(nodeId);
  const classExpression = astNode?.classExpression ?? null;
  // When the element binds class via a JSX expression, never fall back to the
  // iframe's computed class string — that's the resolved value, and writing it
  // back would clobber the binding.
  const classes = classExpression
    ? ""
    : astNode?.classes ?? elementInfo.classes;
  const attributes = astNode?.attributes ?? elementInfo.attributes;
  const isComponent = astNode?.isComponent || /^[A-Z]/.test(elementInfo.tagName);
  const textContent = astNode?.textContent ?? elementInfo.textContent;

  function handleClassesChange(newClasses: string) {
    applyMutation({ type: "update-classes", nodeId, classes: newClasses });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb — ancestor path */}
      <Breadcrumb nodeId={nodeId} />

      {/* Element header */}
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium ${
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

      {userMode === "marketer" ? (
        <div className="flex-1 overflow-auto">
          {isComponent ? (
            <>
              <ComponentPropsPanel
                nodeId={nodeId}
                tagName={astNode?.tagName ?? elementInfo.tagName}
                attributes={attributes}
              />
              {astNode && (
                <SlotContentEditor
                  children={astNode.children}
                  onUpdate={(childId, text) =>
                    applyMutation({ type: "update-text", nodeId: childId, text })
                  }
                />
              )}
              <ComponentContentField
                existingText={astNode?.textContent ?? null}
                hasChildren={(astNode?.children.length ?? 0) > 0}
                hasTextEditableSlots={hasAnyTextEditableSlot(astNode?.children ?? [])}
                onUpdate={(text) => applyMutation({ type: "update-text", nodeId, text })}
                onAdd={(text) =>
                  applyMutation({
                    type: "add-element",
                    parentNodeId: nodeId,
                    position: 0,
                    html: text,
                  })
                }
              />
            </>
          ) : (
            <>
              {/* Raw <a> tags: surface the link editor regardless of whether
                  there's text content (anchors with element children also need
                  href editing). */}
              {elementInfo.tagName.toLowerCase() === "a" && (
                <LinkSection
                  href={attributes.href ?? ""}
                  target={attributes.target}
                  rel={attributes.rel}
                  onAttrChange={(attr, value) =>
                    applyMutation({ type: "update-attribute", nodeId, attr, value })
                  }
                />
              )}
              {textContent !== null ? (
                <InlineTextContentField
                  text={textContent}
                  onUpdate={(text) => applyMutation({ type: "update-text", nodeId, text })}
                />
              ) : elementInfo.tagName.toLowerCase() !== "a" ? (
                <MarketerPlaceholder
                  isComponent={isComponent}
                  tagName={elementInfo.tagName}
                />
              ) : null}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Component-level typed props (variants, etc.) — dev mode.
              Use the AST node's tagName: when DomMapper flattens a component
              to its rendered root (e.g. CardIcon → its outer <div>),
              elementInfo.tagName is the rendered tag, which would route the
              schema lookup at the wrong file and bleed unrelated div
              attributes through the usage-derived fallback. */}
          {isComponent && (
            <ComponentPropsPanel
              nodeId={nodeId}
              tagName={astNode?.tagName ?? elementInfo.tagName}
              attributes={attributes}
            />
          )}

          {/* For empty components only: affordance to add initial slot content.
              Non-empty components get their Content editor from TextTab below. */}
          {isComponent &&
            astNode?.textContent == null &&
            (astNode?.children.length ?? 0) === 0 && (
              <ComponentContentField
                existingText={null}
                hasChildren={false}
                onUpdate={(text) => applyMutation({ type: "update-text", nodeId, text })}
                onAdd={(text) =>
                  applyMutation({
                    type: "add-element",
                    parentNodeId: nodeId,
                    position: 0,
                    html: text,
                  })
                }
              />
            )}

          {/* Token suggestions */}
          <TokenSuggestions
            tagName={elementInfo.tagName}
            classes={classes}
            onClassesChange={handleClassesChange}
          />

          {/* Classes — remembered-open collapsible */}
          <CollapsibleSection storageKey="tve:props:classes" title="Classes">
            {classExpression ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-300/80">
                <div className="mb-1 font-semibold text-amber-300">
                  JSX expression binding
                </div>
                <div className="mb-1 font-mono text-amber-200/70">
                  class={classExpression}
                </div>
                <div className="text-amber-300/60">
                  Class is bound to a variable. Editing here is disabled to avoid
                  breaking the component. Edit the source, or set the class via
                  this component's parent prop.
                </div>
              </div>
            ) : (
              <TailwindClassEditor
                nodeId={nodeId}
                classes={classes}
                onClassesChange={handleClassesChange}
              />
            )}
          </CollapsibleSection>

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
        </>
      )}
    </div>
  );
}

/**
 * Slot-content editor for components in marketer mode. Handles three cases:
 *  1. Empty self-closing component (`<Cta />`) — inserting text converts it to
 *     `<Cta>text</Cta>` via add-element mutation.
 *  2. Existing text content — update-text mutation.
 *  3. Component with non-text children (e.g. <Cta><Icon /></Cta>) — shows a
 *     read-only hint directing the user to the tree for structural editing.
 */
function ComponentContentField({
  existingText,
  hasChildren,
  hasTextEditableSlots,
  onUpdate,
  onAdd,
}: {
  existingText: string | null;
  hasChildren: boolean;
  hasTextEditableSlots?: boolean;
  onUpdate: (text: string) => void;
  onAdd: (text: string) => void;
}) {
  const hasNonTextChildren = hasChildren && existingText == null;

  if (hasNonTextChildren) {
    // If SlotContentEditor already exposed something editable, don't show a
    // redundant "contains nested elements" hint.
    if (hasTextEditableSlots) return null;
    return (
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Content
        </div>
        <p className="text-[11px] text-zinc-500 italic">
          This component contains nested elements. Edit them in the tree view (Dev mode).
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <div className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
        Content
      </div>
      <textarea
        key={existingText ?? "__empty__"}
        defaultValue={existingText ?? ""}
        placeholder={existingText == null ? "Add slot content…" : ""}
        onBlur={(e) => {
          const next = e.target.value;
          const prev = existingText ?? "";
          if (next === prev) return;
          if (existingText == null) {
            if (next.trim()) onAdd(next);
          } else {
            onUpdate(next);
          }
        }}
        rows={3}
        className="w-full resize-y border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 placeholder:text-zinc-600"
      />
      {existingText == null && (
        <p className="mt-1 text-[10px] text-zinc-600">
          Type text and click outside to insert it into this component's slot.
        </p>
      )}
    </div>
  );
}

/** True when the child has direct text content and no structural children. */
function isTextLeaf(child: ASTNode): boolean {
  if (child.isComponent) return false;
  if (/^[A-Z]/.test(child.tagName)) return false;
  if (child.children.length > 0) return false;
  return typeof child.textContent === "string" && child.textContent.length > 0;
}

/** A child is a marketer-editable slot entry when it has a slot attribute or
 *  it's a simple text leaf directly under the component. */
function isEditableSlotChild(child: ASTNode): boolean {
  if (!isTextLeaf(child)) return false;
  // Any direct text leaf qualifies; named slots get a nicer label.
  return true;
}

function hasAnyTextEditableSlot(children: ASTNode[]): boolean {
  return children.some(isEditableSlotChild);
}

function formatSlotLabel(child: ASTNode): string {
  const slot = child.attributes?.slot;
  if (slot) return slot.charAt(0).toUpperCase() + slot.slice(1);
  // No slot attribute — label by tag (p → "Paragraph", h2 → "Heading 2")
  const tag = child.tagName.toLowerCase();
  const map: Record<string, string> = {
    p: "Paragraph",
    span: "Text",
    h1: "Heading 1",
    h2: "Heading 2",
    h3: "Heading 3",
    h4: "Heading 4",
    h5: "Heading 5",
    h6: "Heading 6",
    a: "Link",
    li: "List item",
  };
  return map[tag] || tag;
}

function SlotContentEditor({
  children,
  onUpdate,
}: {
  children: ASTNode[];
  onUpdate: (childId: string, text: string) => void;
}) {
  const editable = children.filter(isEditableSlotChild);
  if (editable.length === 0) return null;

  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Slot content
      </div>
      <div className="space-y-3">
        {editable.map((child) => (
          <div key={child.nodeId} className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-zinc-300 capitalize">
              {formatSlotLabel(child)}
            </label>
            <textarea
              key={child.textContent ?? "__empty__"}
              defaultValue={child.textContent ?? ""}
              rows={Math.min(
                6,
                Math.max(2, Math.ceil((child.textContent?.length ?? 0) / 48))
              )}
              onBlur={(e) => {
                const next = e.target.value;
                if (next !== (child.textContent ?? "")) onUpdate(child.nodeId, next);
              }}
              className="w-full resize-y border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-blue-500 placeholder:text-zinc-600"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Marketer-mode Content editor for raw text elements (h1, p, span, …). Mirrors
 * the ComponentContentField style but targets an existing text node directly
 * instead of component slots.
 */
function InlineTextContentField({
  text,
  onUpdate,
}: {
  text: string;
  onUpdate: (text: string) => void;
}) {
  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Content
      </div>
      <textarea
        key={text}
        defaultValue={text}
        placeholder="Empty — type to add text"
        onBlur={(e) => {
          if (e.target.value !== text) onUpdate(e.target.value);
        }}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 48)))}
        className="w-full resize-y border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-blue-500 placeholder:text-zinc-600"
      />
    </div>
  );
}

function MarketerPlaceholder({
  isComponent,
  tagName,
}: {
  isComponent: boolean;
  tagName: string;
}) {
  return (
    <div className="flex-1 overflow-auto px-4 py-6">
      <div className="border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
          <Sparkles size={12} className="text-emerald-400" />
          {isComponent ? `${tagName} — no marketer controls yet` : "No marketer controls"}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          {isComponent
            ? "This component doesn't have a .tve.ts schema defining marketer-editable props yet."
            : "Raw HTML elements aren't directly editable in marketer mode — use pre-built components instead."}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          Switch to <span className="font-semibold text-zinc-300">Dev</span> mode in the top bar to edit classes and attributes directly.
        </p>
      </div>
    </div>
  );
}
