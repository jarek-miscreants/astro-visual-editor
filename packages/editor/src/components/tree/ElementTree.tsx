import { useState, useRef, useCallback } from "react";
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
import { ChevronRight, ChevronDown, Box, Type, Image, Component, Code, GripVertical, Layers } from "lucide-react";
import type { ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { highlightNodeInIframe } from "../../lib/iframe-bridge";
import { ContextMenu } from "./ContextMenu";
import { AddElementPanel } from "./AddElementPanel";

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

export function ElementTree({ nodes, depth }: ElementTreeProps) {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const ast = useEditorStore((s) => s.ast);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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

    setDropTarget({ nodeId: overId, position });
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

    // Handle slot drop targets (e.g., "nodeId__slot")
    const isSlotDrop = targetId.endsWith("__slot");
    const realTargetId = isSlotDrop ? targetId.replace("__slot", "") : targetId;

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

    applyMutation({
      type: "move-element",
      nodeId: activeId,
      newParentId,
      newPosition,
    });
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
        />
      ))}

      <DragOverlay dropAnimation={null}>
        {draggedNode && (
          <div className="rounded bg-blue-600/20 border border-blue-500/40 px-2 py-1 text-xs text-blue-300 font-mono shadow-lg">
            &lt;{draggedNode.tagName}&gt;
            {draggedNode.classes && (
              <span className="ml-1 text-zinc-500">
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
}: {
  node: ASTNode;
  depth: number;
  dropTarget: DropTarget | null;
  draggedNodeId: string | null;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const hoveredNodeId = useEditorStore((s) => s.hoveredNodeId);
  const selectNode = useEditorStore((s) => s.selectNode);
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile);
  const files = useEditorStore((s) => s.files);
  const nodeRef = useRef<HTMLDivElement>(null);

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

  return (
    <div>
      {/* Drop indicator: before */}
      {dropPosition === "before" && (
        <div
          className="h-0.5 bg-blue-500 rounded-full mx-1"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        />
      )}

      <div
        ref={nodeRef}
        data-tve-node-id={node.nodeId}
        className={`group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
          isDragging
            ? "opacity-30"
            : isSelected
              ? (node.isComponent || node.tagName === "slot") ? "bg-green-600/20 text-green-300" : "bg-blue-600/20 text-blue-300"
              : dropPosition === "inside"
                ? "bg-blue-500/10 border border-blue-500/30 border-dashed"
                : isHovered
                  ? "bg-zinc-800 text-zinc-200"
                  : (node.isComponent || node.tagName === "slot")
                    ? "text-green-400/70 hover:bg-zinc-800/50 hover:text-green-300"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300"
        }`}
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
        // Make this a drag source + drop target using data attributes
        // (we'll use a custom sensor approach below)
      >
        {/* Drag handle */}
        <DragHandle nodeId={node.nodeId} />

        {/* Expand toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="shrink-0 p-0.5 text-zinc-500 hover:text-zinc-300"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Icon */}
        <span className="shrink-0 text-zinc-500">{icon}</span>

        {/* Tag name */}
        <span className="shrink-0 font-mono">{label}</span>

        {/* Class preview */}
        {classPreview && (
          <span className="min-w-0 truncate text-zinc-600 font-mono">
            .{classPreview}
          </span>
        )}

        {/* Dynamic badge */}
        {node.isDynamic && (
          <span className="ml-auto shrink-0 rounded bg-purple-900/40 px-1 text-[9px] text-purple-400">
            expr
          </span>
        )}

        {/* Component badge */}
        {node.isComponent && (
          <span className="ml-auto shrink-0 rounded bg-cyan-900/40 px-1 text-[9px] text-cyan-400">
            comp
          </span>
        )}
      </div>

      {/* Drop indicator: after */}
      {dropPosition === "after" && (
        <div
          className="h-0.5 bg-blue-500 rounded-full mx-1"
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

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              dropTarget={dropTarget}
              draggedNodeId={draggedNodeId}
            />
          ))}
        </div>
      )}

      {/* Slot placeholder for empty components — droppable target */}
      {expanded && node.isComponent && !hasChildren && (
        <SlotPlaceholder nodeId={node.nodeId} depth={depth + 1} />
      )}
    </div>
  );
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

function SlotPlaceholder({ nodeId, depth, slotName }: { nodeId: string; depth: number; slotName?: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const { setNodeRef } = useDroppable({ id: `${nodeId}__slot` });

  return (
    <div ref={setNodeRef}>
      <div
        className="flex cursor-pointer items-center gap-1.5 rounded border border-dashed border-green-500/30 mx-1 my-0.5 px-2 py-1 text-[10px] text-green-500/60 hover:border-green-500/60 hover:text-green-400 transition-colors"
        style={{ marginLeft: `${depth * 12 + 4}px` }}
        onClick={() => setShowAdd(!showAdd)}
      >
        <SlotIcon size={11} />
        <span className="italic">{slotName ? `slot: ${slotName}` : "default slot"}</span>
        <span className="ml-auto text-[8px] text-zinc-600">drop or click</span>
      </div>
      {showAdd && (
        <div className="ml-4">
          <AddElementPanel
            onSelect={(html) => {
              applyMutation({
                type: "add-element",
                parentNodeId: nodeId,
                position: 0,
                html,
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

// ── Drag handle using @dnd-kit's useDraggable ──────────────────

import { useDraggable, useDroppable } from "@dnd-kit/core";

function DragHandle({ nodeId }: { nodeId: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: nodeId });
  const { setNodeRef: setDropRef } = useDroppable({ id: nodeId });

  // Combine refs
  const combinedRef = useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el);
      setDropRef(el);
    },
    [setNodeRef, setDropRef]
  );

  return (
    <span
      ref={combinedRef}
      {...listeners}
      {...attributes}
      className="shrink-0 cursor-grab text-zinc-600 opacity-0 group-hover:opacity-100 active:cursor-grabbing"
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical size={10} />
    </span>
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
