import { useState } from "react";
import { Paintbrush, LayoutGrid, Type as TypeIcon, Sparkles } from "lucide-react";
import type { ElementInfo, ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { TailwindClassEditor } from "./TailwindClassEditor";
import { AttributesPanel, splitAttributes } from "./AttributesPanel";
import { ComponentPropsPanel } from "./ComponentPropsPanel";
import { TokenSuggestions } from "./TokenSuggestions";
import { StyleTab } from "./StyleTab";
import { LayoutTab } from "./LayoutTab";
import { TextTab } from "./TextTab";
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

  // Dev mode shows raw attrs split into user-facing vs Astro-injected debug
  // attrs. Marketer mode never shows raw attributes at all.
  const { user: userAttrs, debug: debugAttrs } = splitAttributes(attributes);

  return (
    <div className="flex h-full flex-col">
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
          {/* 1. Classes — most-edited control sits at the top. Stays open by
              default; defaultOpen flag is honored by the persisted store. */}
          <CollapsibleSection storageKey="tve:props:classes" title="Classes">
            {classExpression ? (
              <div className="tve-prop-warning-card">
                <div className="tve-prop-warning-card__title">JSX expression binding</div>
                <div className="tve-prop-warning-card__code">class={classExpression}</div>
                <div className="tve-prop-warning-card__desc">
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

          {/* 2. Content — typed component Content + Link fields, plus the
              empty-component slot affordance. Use astNode.tagName to keep
              the schema lookup pointed at the component file even when
              DomMapper flattened it to its rendered root tag. */}
          {isComponent && (
            <ComponentPropsPanel
              nodeId={nodeId}
              tagName={astNode?.tagName ?? elementInfo.tagName}
              attributes={attributes}
              mode="content"
            />
          )}

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

          {/* 3. Attributes — only the user-facing ones. Astro debug attrs
              (data-astro-source-*) are pushed into Advanced below. */}
          <AttributesPanel nodeId={nodeId} attributes={userAttrs} />

          {/* 4. Tabs */}
          <div className="tve-prop-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="tve-prop-tab"
                data-active={activeTab === tab.id || undefined}
              >
                {tab.icon}
                {tab.label}
                {activeTab === tab.id && <span className="tve-prop-tab__indicator" />}
              </button>
            ))}
          </div>

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

          {/* 5. Advanced — collapsed by default. Houses tokens, the
              component's advanced typed props, and Astro debug attrs.
              Lives at the bottom of the panel because none of these are
              part of the day-to-day editing loop. */}
          <CollapsibleSection
            storageKey="tve:props:advanced"
            title="Advanced"
            defaultOpen={false}
          >
            <TokenSuggestions
              tagName={elementInfo.tagName}
              classes={classes}
              onClassesChange={handleClassesChange}
            />
            {isComponent && (
              <ComponentPropsPanel
                nodeId={nodeId}
                tagName={astNode?.tagName ?? elementInfo.tagName}
                attributes={attributes}
                mode="advanced"
              />
            )}
            {Object.keys(debugAttrs).length > 0 && (
              <AttributesPanel
                nodeId={nodeId}
                attributes={debugAttrs}
                title="Debug attributes"
                embedded
              />
            )}
          </CollapsibleSection>
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
    if (hasTextEditableSlots) return null;
    return (
      <div className="tve-prop-section">
        <div className="tve-prop-section__header">Content</div>
        <p className="tve-prop-section__hint">
          This component contains nested elements. Edit them in the tree view (Dev mode).
        </p>
      </div>
    );
  }

  return (
    <div className="tve-prop-section">
      <div className="tve-prop-section__header">Content</div>
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
        className="tve-prop-textarea"
      />
      {existingText == null && (
        <p className="tve-prop-section__hint" style={{ marginTop: 4 }}>
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
    <div className="tve-prop-section">
      <div className="tve-prop-section__header">Slot content</div>
      <div className="tve-prop-stack">
        {editable.map((child) => (
          <div key={child.nodeId} className="tve-prop-field">
            <label className="tve-prop-field__label--prominent">
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
              className="tve-prop-textarea tve-prop-textarea--prominent"
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
    <div className="tve-prop-section">
      <div className="tve-prop-section__header">Content</div>
      <textarea
        key={text}
        defaultValue={text}
        placeholder="Empty — type to add text"
        onBlur={(e) => {
          if (e.target.value !== text) onUpdate(e.target.value);
        }}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 48)))}
        className="tve-prop-textarea tve-prop-textarea--prominent"
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
      <div className="tve-prop-marketer-card">
        <div className="tve-prop-marketer-card__title">
          <Sparkles size={12} style={{ color: "var(--prop-emerald)" }} />
          {isComponent ? `${tagName} — no marketer controls yet` : "No marketer controls"}
        </div>
        <p className="tve-prop-marketer-card__body">
          {isComponent
            ? "This component doesn't have a .tve.ts schema defining marketer-editable props yet."
            : "Raw HTML elements aren't directly editable in marketer mode — use pre-built components instead."}
        </p>
        <p className="tve-prop-marketer-card__hint">
          Switch to <span style={{ fontWeight: 600, color: "var(--prop-section-title-color-hover)" }}>Dev</span> mode in the top bar to edit classes and attributes directly.
        </p>
      </div>
    </div>
  );
}
