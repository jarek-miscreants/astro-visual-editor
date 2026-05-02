import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Box, Type, Image, Component, Code, GripVertical } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { useTreeUIStore } from "../../store/tree-ui-store";
import { useComponentSlotsStore } from "../../store/component-slots-store";
import { highlightNodeInIframe } from "../../lib/iframe-bridge";
import { ContextMenu } from "./ContextMenu";
import { AddElementPanel } from "./AddElementPanel";

/** Insert (or replace) a `slot="..."` attribute on the first opening tag of
 *  an HTML snippet so children dropped into a named slot get the right
 *  routing without the user having to know slot names. Self-closing tags
 *  preserve `/>`; bare tags get the attribute appended right after the tag
 *  name. Empty slot name (default slot) is a no-op. */
function injectSlotAttr(html: string, slotName: string | null): string {
  if (!slotName) return html;
  const m = html.match(/^\s*<([A-Za-z][\w-]*)\b/);
  if (!m) return html;
  const tagEnd = m.index! + m[0].length;
  // Replace existing slot=... if present in this opening tag, else inject one.
  const openTagEnd = findOpenTagEnd(html, m.index!);
  if (openTagEnd === -1) return html;
  const openTag = html.slice(m.index!, openTagEnd);
  const slotRe = /\sslot\s*=\s*("[^"]*"|'[^']*')/;
  if (slotRe.test(openTag)) {
    return html.slice(0, m.index!) + openTag.replace(slotRe, ` slot="${slotName}"`) + html.slice(openTagEnd);
  }
  return html.slice(0, tagEnd) + ` slot="${slotName}"` + html.slice(tagEnd);
}

function findOpenTagEnd(source: string, tagStart: number): number {
  let i = tagStart;
  let inQuote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else {
      if (ch === '"' || ch === "'") inQuote = ch;
      else if (ch === ">") return i + 1;
    }
    i++;
  }
  return -1;
}

interface ElementTreeProps {
  nodes: ASTNode[];
  depth: number;
}

/** Drop position relative to a target node */
type DropPosition = "before" | "after" | "inside";

interface DropTarget {
  nodeId: string;
  position: DropPosition;
}

// ── Root wrapper with DnD context ──────────────────────────────

/** First ~30 chars of direct text inside an element (not descendants). */
function getTextPreview(node: ASTNode): string | null {
  if (node.textContent && node.textContent.trim()) {
    const t = node.textContent.trim().replace(/\s+/g, " ");
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }
  return null;
}

/** Does the node's subtree contain a direct-text element we'd show? */
function hasMeaningfulDescendant(node: ASTNode): boolean {
  if (isMeaningful(node)) return true;
  for (const child of node.children) {
    if (hasMeaningfulDescendant(child)) return true;
  }
  return false;
}

/** "Meaningful" nodes that are worth showing in marketer zoom. */
function isMeaningful(node: ASTNode): boolean {
  if (node.isComponent || /^[A-Z]/.test(node.tagName)) return true;
  if (node.tagName === "slot") return true;
  const tag = node.tagName.toLowerCase();
  if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "img", "picture", "video", "button"].includes(tag)) {
    return true;
  }
  return false;
}

/** Does the node or any ancestor/descendant match the search query? */
function matchesSearch(node: ASTNode, q: string): boolean {
  const needle = q.toLowerCase();
  const hay = [
    node.tagName,
    node.classes,
    node.textContent ?? "",
    ...Object.entries(node.attributes || {}).map(([k, v]) => `${k}=${v}`),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function subtreeMatchesSearch(node: ASTNode, q: string): boolean {
  if (matchesSearch(node, q)) return true;
  for (const child of node.children) {
    if (subtreeMatchesSearch(child, q)) return true;
  }
  return false;
}

export function ElementTree({ nodes, depth }: ElementTreeProps) {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const ast = useEditorStore((s) => s.ast);
  const userMode = useModeStore((s) => s.userMode);
  const query = useTreeUIStore((s) => s.query).trim();
  const marketerZoom = useTreeUIStore((s) => s.marketerZoom);
  const zoomActive = userMode === "marketer" && marketerZoom;

  // distance: 8px threshold lets plain clicks through without starting a drag,
  // without adding delay (which would make the drag feel sluggish, not snappier).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function findParent(
    searchNodes: ASTNode[],
    targetId: string
  ): { parent: ASTNode; index: number } | null {
    for (const n of searchNodes) {
      for (let i = 0; i < n.children.length; i++) {
        if (n.children[i].nodeId === targetId) {
          return { parent: n, index: i };
        }
      }
      const found = findParent(n.children, targetId);
      if (found) return found;
    }
    return null;
  }

  function findNode(searchNodes: ASTNode[], id: string): ASTNode | null {
    for (const n of searchNodes) {
      if (n.nodeId === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggedNodeId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!event.over) {
      setDropTarget(null);
      return;
    }

    const overId = event.over.id as string;
    const activeId = event.active.id as string;
    if (overId === activeId) {
      setDropTarget(null);
      return;
    }

    // Determine drop position based on pointer Y within the target element
    // Default to "inside" (drop as child) — only use before/after at the very edges (4px)
    const overRect = event.over.rect;
    const pointerY = (event.activatorEvent as MouseEvent).clientY + (event.delta?.y ?? 0);
    const relativeY = pointerY - overRect.top;
    const height = overRect.height;
    const edgeZone = 4; // pixels from top/bottom edge for before/after

    let position: DropPosition;
    if (relativeY < edgeZone) {
      position = "before";
    } else if (relativeY > height - edgeZone) {
      position = "after";
    } else {
      position = "inside";
    }

    setDropTarget((prev) => {
      if (prev && prev.nodeId === overId && prev.position === position) return prev;
      return { nodeId: overId, position };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = event.active.id as string;
    setDraggedNodeId(null);

    if (!dropTarget || !ast) {
      setDropTarget(null);
      return;
    }

    const { nodeId: targetId, position } = dropTarget;
    setDropTarget(null);

    // Handle slot drop targets. Two flavours:
    //   "nodeId__slot"          — legacy / default slot
    //   "nodeId__slot:<name>"   — named slot; we'll also set slot="<name>"
    //                              on the moved element so it routes correctly.
    let slotName: string | null | undefined; // undefined = not a slot drop
    let realTargetId = targetId;
    const namedSlotMatch = /__slot:(.+)$/.exec(targetId);
    if (namedSlotMatch) {
      slotName = namedSlotMatch[1];
      realTargetId = targetId.slice(0, namedSlotMatch.index);
    } else if (targetId.endsWith("__slot")) {
      slotName = null;
      realTargetId = targetId.replace("__slot", "");
    }
    const isSlotDrop = slotName !== undefined;

    // Don't drop onto self
    if (activeId === realTargetId) return;

    // Don't drop a parent into its own child (would create a cycle)
    const draggedNode = findNode(ast, activeId);
    if (draggedNode && findNode(draggedNode.children, realTargetId)) return;

    let newParentId: string;
    let newPosition: number;

    if (isSlotDrop) {
      // Dropped on a slot placeholder — insert as first child of the component
      newParentId = realTargetId;
      newPosition = 0;
    } else if (position === "inside") {
      // Drop as last child of target
      const target = findNode(ast, realTargetId);
      newParentId = realTargetId;
      newPosition = target?.children.length ?? 0;
    } else {
      // Drop as sibling before/after target
      const parentInfo = findParent(ast, realTargetId);
      if (!parentInfo) return;
      newParentId = parentInfo.parent.nodeId;
      newPosition = position === "before" ? parentInfo.index : parentInfo.index + 1;
    }

    // Mutation positions are final child indexes after the dragged node is
    // removed. Tree sibling targets are measured against the pre-move AST, so
    // same-parent forward moves need to shift back by one.
    const oldParentInfo = findParent(ast, activeId);
    if (
      oldParentInfo &&
      oldParentInfo.parent.nodeId === newParentId &&
      newPosition > oldParentInfo.index
    ) {
      newPosition -= 1;
    }

    applyMutation({
      type: "move-element",
      nodeId: activeId,
      newParentId,
      newPosition,
    });
    // Note: when dragging an existing element into a named slot we do NOT
    // chain an update-attribute mutation. Positional nodeIds get re-assigned
    // after a move, so the second mutation would race against the AST refresh
    // and likely target the wrong element. The slot-routing benefit lives on
    // the insert path (AddElementPanel → injectSlotAttr), which can bake
    // `slot="..."` into the freshly emitted HTML.
  }

  function handleDragCancel() {
    setDraggedNodeId(null);
    setDropTarget(null);
  }

  const draggedNode = draggedNodeId && ast ? findNode(ast, draggedNodeId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {nodes.map((node) => (
        <TreeNode
          key={node.nodeId}
          node={node}
          depth={depth}
          dropTarget={dropTarget}
          draggedNodeId={draggedNodeId}
          zoomActive={zoomActive}
          query={query}
        />
      ))}

      <DragOverlay dropAnimation={null}>
        {draggedNode && (
          <div className="tve-tree-drag-overlay">
            &lt;{draggedNode.tagName}&gt;
            {draggedNode.classes && (
              <span className="tve-tree-drag-overlay__classes">
                .{draggedNode.classes.split(" ")[0]}
              </span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Individual tree node (draggable + droppable) ───────────────

function TreeNode({
  node,
  depth,
  dropTarget,
  draggedNodeId,
  zoomActive,
  query,
}: {
  node: ASTNode;
  depth: number;
  dropTarget: DropTarget | null;
  draggedNodeId: string | null;
  zoomActive: boolean;
  query: string;
}) {
  // Zoom: when the node isn't "meaningful" (structural wrapper), don't render its
  // own row — flatten by rendering its children at the same depth. Keep rendering
  // if the subtree has no meaningful descendants either (fallback to something).
  if (zoomActive && !isMeaningful(node) && hasMeaningfulDescendant(node)) {
    return (
      <>
        {node.children.map((child) => (
          <TreeNode
            key={child.nodeId}
            node={child}
            depth={depth}
            dropTarget={dropTarget}
            draggedNodeId={draggedNodeId}
            zoomActive={zoomActive}
            query={query}
          />
        ))}
      </>
    );
  }

  // Search: filter by subtree match. Expand matching paths.
  if (query && !subtreeMatchesSearch(node, query)) {
    return null;
  }
  // Components default to expanded so the slot placeholder is visible. When
  // searching, auto-expand any node whose subtree matches.
  const [expanded, setExpanded] = useState(depth < 2 || node.isComponent);
  if (query && !expanded && subtreeMatchesSearch(node, query)) {
    setExpanded(true);
  }
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const hoveredNodeId = useEditorStore((s) => s.hoveredNodeId);
  const selectNode = useEditorStore((s) => s.selectNode);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);
  const files = useEditorStore((s) => s.files);
  const nodeRef = useRef<HTMLDivElement>(null);

  // Components have a virtual slot child even when empty
  const hasSlot = node.isComponent && node.children.length === 0;

  // Auto-expand if a descendant is selected
  const hasSelectedDescendant = selectedNodeId
    ? containsNode(node.children, selectedNodeId)
    : false;
  if (hasSelectedDescendant && !expanded) {
    setExpanded(true);
  }

  const isSelected = selectedNodeId === node.nodeId;
  const isHovered = hoveredNodeId === node.nodeId;
  const hasChildren = node.children.length > 0;
  const isDragging = draggedNodeId === node.nodeId;

  // Drag + drop wired to the whole row — click passes through thanks to
  // the 8px activation distance set on the PointerSensor.
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: node.nodeId });
  const { setNodeRef: setDropRef } = useDroppable({ id: node.nodeId });
  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      (nodeRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef]
  );

  // Scroll into view when selected from iframe
  if (isSelected && nodeRef.current) {
    nodeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // Drop indicator state
  const isDropTarget = dropTarget?.nodeId === node.nodeId;
  const dropPosition = isDropTarget ? dropTarget.position : null;

  const icon = getNodeIcon(node);
  const label = node.tagName;
  const classPreview = node.classes
    ? node.classes.split(" ").slice(0, 3).join(" ") +
      (node.classes.split(" ").length > 3 ? "..." : "")
    : "";
  const textPreview = getTextPreview(node);

  function makeElementInfo() {
    return {
      nodeId: node.nodeId,
      tagName: node.tagName,
      classes: node.classes,
      textContent: node.textContent,
      attributes: node.attributes,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      computedStyles: {
        display: "", position: "", padding: "",
        margin: "", fontSize: "", color: "", backgroundColor: "",
      },
    };
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    selectNode(node.nodeId, makeElementInfo());
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  const rowKind = node.isComponent ? "component" : node.tagName === "slot" ? "slot" : "tag";

  return (
    <div>
      {/* Drop indicator: before */}
      {dropPosition === "before" && (
        <div
          className="tve-tree-drop-line"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        />
      )}

      <div
        ref={setRowRef}
        data-tve-node-id={node.nodeId}
        {...listeners}
        {...attributes}
        className="tve-tree-row group"
        data-kind={rowKind}
        data-selected={isSelected || undefined}
        data-hovered={!isSelected && isHovered || undefined}
        data-dragging={isDragging || undefined}
        data-drop={dropPosition === "inside" ? "inside" : undefined}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => {
          selectNode(node.nodeId, makeElementInfo());
          highlightNodeInIframe(node.nodeId);
        }}
        onDoubleClick={() => {
          if (node.isComponent) {
            const componentFile = files.find(
              (f) => f.type === "component" && f.path.endsWith(`/${node.tagName}.astro`)
            );
            if (componentFile) {
              setCurrentFile(componentFile.path);
            }
          }
        }}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => highlightNodeInIframe(node.nodeId)}
        onMouseLeave={() => highlightNodeInIframe(null)}
      >
        <span className="tve-tree-row__grip">
          <GripVertical size={10} />
        </span>

        {hasChildren || hasSlot ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="tve-tree-row__chevron"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="tve-tree-row__chevron-spacer" />
        )}

        <span className="tve-tree-row__icon">{icon}</span>

        <span className="tve-tree-row__label">{label}</span>

        {textPreview && (
          <span className="tve-tree-row__text-preview">"{textPreview}"</span>
        )}

        {!textPreview && classPreview && (
          <span className="tve-tree-row__class-preview">.{classPreview}</span>
        )}

        {node.isDynamic && (
          <span className="tve-tree-badge tve-tree-badge--expr">expr</span>
        )}

        {node.isComponent && (
          <span className="tve-tree-badge tve-tree-badge--comp">comp</span>
        )}
      </div>

      {/* Drop indicator: after */}
      {dropPosition === "after" && (
        <div
          className="tve-tree-drop-line"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          node={node}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Children + slots. For non-components we just render children in
          source order. For components we group children by their `slot`
          attribute so each declared slot gets its own labelled section,
          even when empty — drop targets carry the slot name so inserted
          children pick up `slot="..."` automatically. */}
      {expanded && (
        node.isComponent ? (
          <ComponentChildren
            node={node}
            depth={depth}
            dropTarget={dropTarget}
            draggedNodeId={draggedNodeId}
            zoomActive={zoomActive}
            query={query}
          />
        ) : hasChildren ? (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.nodeId}
                node={child}
                depth={depth + 1}
                dropTarget={dropTarget}
                draggedNodeId={draggedNodeId}
                zoomActive={zoomActive}
                query={query}
              />
            ))}
          </div>
        ) : null
      )}
    </div>
  );
}

/** Renders a component's children grouped by the slot they target. Looks up
 *  the component's `<slot>` declarations from the cache (fetched on first
 *  render) and renders one section per declared slot. Children whose
 *  `slot=` doesn't match any declared name are surfaced under an
 *  "unmatched" section so authors can spot mistakes (typos, casing). */
function ComponentChildren({
  node,
  depth,
  dropTarget,
  draggedNodeId,
  zoomActive,
  query,
}: {
  node: ASTNode;
  depth: number;
  dropTarget: DropTarget | null;
  draggedNodeId: string | null;
  zoomActive: boolean;
  query: string;
}) {
  const files = useEditorStore((s) => s.files);
  const ensureSlots = useComponentSlotsStore((s) => s.ensure);
  const cachedSlots = useComponentSlotsStore((s) => s.cache[componentPathFor(files, node.tagName) ?? ""]);

  const componentPath = componentPathFor(files, node.tagName);

  useEffect(() => {
    if (componentPath) ensureSlots(componentPath);
  }, [componentPath, ensureSlots]);

  // While slots are loading or the component isn't a project file (external
  // packages — Icon, etc.), fall back to the legacy "children + single slot
  // placeholder" layout so the user can still navigate.
  const slotsKnown = Array.isArray(cachedSlots);

  if (!slotsKnown || cachedSlots!.length === 0) {
    // Legacy path: render children in order, plus a single anonymous slot
    // placeholder when empty. Either we don't know the slots, or the
    // component declared none.
    const hasChildren = node.children.length > 0;
    return (
      <>
        {hasChildren && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.nodeId}
                node={child}
                depth={depth + 1}
                dropTarget={dropTarget}
                draggedNodeId={draggedNodeId}
                zoomActive={zoomActive}
                query={query}
              />
            ))}
          </div>
        )}
        {!hasChildren && (
          <SlotPlaceholder nodeId={node.nodeId} depth={depth + 1} slotName={null} />
        )}
      </>
    );
  }

  // Group children by their slot attribute. `null` key collects children
  // without a slot attribute (i.e. default-slot content).
  const childrenBySlot = new Map<string | null, ASTNode[]>();
  const matched = new Set<string>();
  for (const child of node.children) {
    const slotAttr = child.attributes.slot ?? null;
    const list = childrenBySlot.get(slotAttr) ?? [];
    list.push(child);
    childrenBySlot.set(slotAttr, list);
    matched.add(child.nodeId);
  }

  // Children whose slot doesn't match any declared slot — typo / casing
  // mistake. Surface them so they're visible (and editable) instead of
  // disappearing from the tree.
  const declaredNames = new Set(cachedSlots!.map((s) => s.name));
  const unmatched: ASTNode[] = [];
  for (const [slotName, kids] of childrenBySlot) {
    if (!declaredNames.has(slotName)) unmatched.push(...kids);
  }

  return (
    <div>
      {cachedSlots!.map((slotDef) => {
        const kids = childrenBySlot.get(slotDef.name) ?? [];
        return (
          <SlotSection
            key={slotDef.name ?? "__default__"}
            parentNodeId={node.nodeId}
            slotName={slotDef.name}
            children={kids}
            depth={depth + 1}
            dropTarget={dropTarget}
            draggedNodeId={draggedNodeId}
            zoomActive={zoomActive}
            query={query}
          />
        );
      })}
      {unmatched.length > 0 && (
        <div>
          <div
            className="tve-tree-unmatched"
            style={{ marginLeft: `${(depth + 1) * 12 + 4}px` }}
            title="These children target slot names that the component doesn't declare — likely a typo. They will not render."
          >
            <SlotIcon size={11} />
            <span>unmatched slot</span>
          </div>
          {unmatched.map((child) => (
            <TreeNode
              key={child.nodeId}
              node={child}
              depth={depth + 2}
              dropTarget={dropTarget}
              draggedNodeId={draggedNodeId}
              zoomActive={zoomActive}
              query={query}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single labelled slot section: header row + child nodes + drop target.
 *  Even non-empty named slots show the header so the user can tell which
 *  slot a child belongs to without reading the source. */
function SlotSection({
  parentNodeId,
  slotName,
  children,
  depth,
  dropTarget,
  draggedNodeId,
  zoomActive,
  query,
}: {
  parentNodeId: string;
  slotName: string | null;
  children: ASTNode[];
  depth: number;
  dropTarget: DropTarget | null;
  draggedNodeId: string | null;
  zoomActive: boolean;
  query: string;
}) {
  return (
    <>
      <SlotPlaceholder
        nodeId={parentNodeId}
        depth={depth}
        slotName={slotName}
        empty={children.length === 0}
      />
      {children.map((child) => (
        <TreeNode
          key={child.nodeId}
          node={child}
          depth={depth + 1}
          dropTarget={dropTarget}
          draggedNodeId={draggedNodeId}
          zoomActive={zoomActive}
          query={query}
        />
      ))}
    </>
  );
}

/** Resolve a tagName to its project component path so we can look up its
 *  slot declarations. Returns null for external/non-project tags (Icon
 *  from astro-icon, etc.) — the caller falls back to the legacy view. */
function componentPathFor(
  files: import("@tve/shared").FileInfo[],
  tagName: string
): string | null {
  const f = files.find((f) => f.type === "component" && f.path.endsWith(`/${tagName}.astro`));
  return f?.path ?? null;
}

// ── Slot placeholder for empty components ──────────────────────

function SlotIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 3C2 2.44772 2.44772 2 3 2H4.25V3L3 3V4.25H2V3ZM9.25 3H6.75V2H9.25V3ZM13 3H11.75V2H13C13.5523 2 14 2.44772 14 3V4.25H13V3ZM3 6.75V9.25H2V6.75H3ZM13 9.25V6.75H14V9.25H13ZM3 11.75V13H4.25V14H3C2.44772 14 2 13.5523 2 13V11.75H3ZM13 13V11.75H14V13C14 13.5523 13.5523 14 13 14H11.75V13H13ZM6.75 13H9.25V14H6.75V13Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SlotPlaceholder({
  nodeId,
  depth,
  slotName,
  empty = true,
}: {
  nodeId: string;
  depth: number;
  /** Named slot key to inject into inserted HTML. null = default slot
   *  (no `slot=` attribute applied). undefined = legacy "single slot
   *  placeholder" mode (treated as default). */
  slotName?: string | null;
  /** Whether the slot currently has children. Non-empty slots show a
   *  smaller header label rather than the dashed dropzone. */
  empty?: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const dropId = slotName
    ? `${nodeId}__slot:${slotName}`
    : `${nodeId}__slot`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  // Non-empty named slot: small header strip, still a drop target so users
  // can append more children to it. Empty: full dashed dropzone with the
  // "drop or click" affordance.
  if (!empty) {
    return (
      <div ref={setNodeRef}>
        <div
          className="tve-slot-header"
          data-over={isOver || undefined}
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        >
          <SlotIcon size={11} />
          <span>{slotName ?? "default slot"}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef}>
      <div
        className="tve-slot-placeholder"
        data-over={isOver || undefined}
        style={{ marginLeft: `${depth * 12 + 4}px` }}
        onClick={() => setShowAdd(!showAdd)}
      >
        <SlotIcon size={11} />
        <span className="tve-slot-placeholder__name">{slotName ? slotName : "default slot"}</span>
        <span className="tve-slot-placeholder__hint">drop or click</span>
      </div>
      {showAdd && (
        <div className="ml-4">
          <AddElementPanel
            onSelect={(html, options) => {
              const finalHtml = injectSlotAttr(html, slotName ?? null);
              applyMutation({
                type: "add-element",
                parentNodeId: nodeId,
                position: 0,
                html: finalHtml,
                componentPath: options?.componentPath,
              });
              setShowAdd(false);
            }}
            onClose={() => setShowAdd(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────

function getNodeIcon(node: ASTNode) {
  if (node.isComponent) return <Component size={11} />;
  if (node.tagName === "slot") return <SlotIcon size={11} />;
  if (node.isDynamic) return <Code size={11} />;

  const tag = node.tagName.toLowerCase();
  if (tag === "img" || tag === "picture" || tag === "video") return <Image size={11} />;
  if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a"].includes(tag))
    return <Type size={11} />;
  return <Box size={11} />;
}

// ── Helpers ────────────────────────────────────────────────────

/** Check if any descendant has the given nodeId */
function containsNode(nodes: ASTNode[], targetId: string): boolean {
  for (const n of nodes) {
    if (n.nodeId === targetId) return true;
    if (containsNode(n.children, targetId)) return true;
  }
  return false;
}
