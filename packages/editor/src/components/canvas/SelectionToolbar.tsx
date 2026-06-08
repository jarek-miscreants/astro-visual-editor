import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Copy, Trash2, ArrowUp, ArrowDown, PlusCircle, Component } from "lucide-react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { makeAddElementMutation } from "../../lib/component-insertion";
import { toast } from "../../store/toast-store";
import { Tooltip } from "../ui/Tooltip";
import { AddElementPanel } from "../tree/AddElementPanel";
import { findComponentFile } from "../../lib/component-files";

interface Props {
  /** Ref to the iframe so we can compute its page offset. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

/**
 * Floating action toolbar anchored to the current selection in the iframe.
 * Lives in the outer page so it can use the editor's store + mutation pipeline
 * directly. Position is recomputed whenever the selection rect changes or the
 * iframe scrolls/resizes.
 */
export function SelectionToolbar({ iframeRef }: Props) {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedElementInfo = useEditorStore((s) => s.selectedElementInfo);
  const ast = useEditorStore((s) => s.ast);
  const files = useEditorStore((s) => s.files);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const enterComponent = useEditorStore((s) => s.enterComponent);
  const userMode = useModeStore((s) => s.userMode);

  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [showAddChild, setShowAddChild] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Reset the panel when selection changes — otherwise it lingers anchored
  // to the previous element's coords.
  useEffect(() => {
    setShowAddChild(false);
  }, [selectedNodeId]);

  // Close on outside click
  useEffect(() => {
    if (!showAddChild) return;
    function onMouseDown(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        addBtnRef.current &&
        !addBtnRef.current.contains(e.target as Node)
      ) {
        setShowAddChild(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showAddChild]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !selectedElementInfo) {
      setCoords(null);
      return;
    }

    function recompute() {
      if (!iframe || !selectedElementInfo) return;
      const iframeRect = iframe.getBoundingClientRect();
      const sel = selectedElementInfo.rect;

      // Toolbar width — measure if rendered, otherwise fall back to a sensible
      // estimate (5 buttons × 24px + gaps + padding ≈ 138px). Pre-render width
      // matters because the FIRST recompute runs before the toolbar is mounted.
      const tbWidth = toolbarRef.current?.offsetWidth ?? 138;
      const tbHeight = toolbarRef.current?.offsetHeight ?? 30;

      setCoords(computeToolbarCoords(iframeRect, sel, tbWidth, tbHeight));
    }

    recompute();

    // Listen for scroll inside the iframe so the toolbar stays anchored.
    const win = iframe.contentWindow;
    const onScroll = () => recompute();
    const onResize = () => recompute();
    try {
      win?.addEventListener("scroll", onScroll, true);
    } catch {
      /* cross-origin — ignore */
    }
    window.addEventListener("resize", onResize);
    return () => {
      try {
        win?.removeEventListener("scroll", onScroll, true);
      } catch {
        /* ignore */
      }
      window.removeEventListener("resize", onResize);
    };
  }, [selectedElementInfo, iframeRef]);

  // After the toolbar first renders we have its real width — recompute once
  // so the initial centering doesn't rely on the 138px estimate. Subsequent
  // selection changes go through the main effect's recompute loop.
  useLayoutEffect(() => {
    if (!toolbarRef.current || !iframeRef.current || !selectedElementInfo) return;
    const iframe = iframeRef.current;
    const iframeRect = iframe.getBoundingClientRect();
    const sel = selectedElementInfo.rect;
    const tbWidth = toolbarRef.current.offsetWidth;
    const tbHeight = toolbarRef.current.offsetHeight;
    const { top, left } = computeToolbarCoords(iframeRect, sel, tbWidth, tbHeight);
    setCoords((prev) => {
      if (prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5) {
        return prev;
      }
      return { top, left };
    });
  }, [selectedNodeId, selectedElementInfo, iframeRef]);

  if (!selectedNodeId || !selectedElementInfo || !coords) return null;

  // Find siblings so we can disable up/down at edges.
  const parentInfo = ast ? findParent(ast, selectedNodeId) : null;
  const index = parentInfo?.index ?? -1;
  const siblingCount = parentInfo?.parent.children.length ?? 0;
  const canMoveUp = index > 0;
  const canMoveDown = index >= 0 && index < siblingCount - 1;

  function moveSibling(direction: -1 | 1) {
    if (!parentInfo || !selectedNodeId) return;
    const newPosition = parentInfo.index + direction;
    if (newPosition < 0 || newPosition >= parentInfo.parent.children.length) return;
    if (newPosition === parentInfo.index) return;
    applyMutation({
      type: "move-element",
      nodeId: selectedNodeId,
      newParentId: parentInfo.parent.nodeId,
      newPosition,
    });
  }

  // Look up the selected node so the add-child mutation knows the current
  // child count (insertion position). Empty self-closing components like
  // <CardIcon /> still get this button — the file-writer expands them on
  // child insertion.
  const selectedNode = ast ? findNode(ast, selectedNodeId) : null;
  const childCount = selectedNode?.children.length ?? 0;
  const componentFile =
    selectedNode && (selectedNode.isComponent || /^[A-Z]/.test(selectedNode.tagName))
      ? findComponentFile(files, selectedNode.tagName)
      : undefined;

  function handleAddChild(html: string, options?: { componentPath?: string }) {
    if (!selectedNodeId) return;
    if (userMode === "marketer") {
      const mutation = makeAddElementMutation(ast, selectedNodeId, html, options?.componentPath);
      if (!mutation) {
        toast.error("No insertion target", "Open a page with a block container.");
        return;
      }
      applyMutation(mutation);
      setShowAddChild(false);
      return;
    }

    applyMutation({
      type: "add-element",
      parentNodeId: selectedNodeId,
      position: childCount,
      html,
      componentPath: options?.componentPath,
    });
    setShowAddChild(false);
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[60] flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 p-0.5 shadow-lg shadow-black/30 backdrop-blur"
      style={{ top: coords.top, left: coords.left }}
    >
      <Tooltip content={userMode === "marketer" ? "Add block" : "Add child"}>
        <button
          aria-label="Add child"
          ref={addBtnRef}
          onClick={() => setShowAddChild((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <PlusCircle size={12} />
        </button>
      </Tooltip>
      {componentFile && (
        <Tooltip content="Enter component">
          <ToolbarButton
            ariaLabel="Enter component"
            onClick={() => enterComponent(selectedNodeId)}
            accent
          >
            <Component size={12} />
          </ToolbarButton>
        </Tooltip>
      )}
      <Tooltip content="Move up">
        <ToolbarButton
          ariaLabel="Move up"
          disabled={!canMoveUp}
          onClick={() => moveSibling(-1)}
        >
          <ArrowUp size={12} />
        </ToolbarButton>
      </Tooltip>
      <Tooltip content="Move down">
        <ToolbarButton
          ariaLabel="Move down"
          disabled={!canMoveDown}
          onClick={() => moveSibling(1)}
        >
          <ArrowDown size={12} />
        </ToolbarButton>
      </Tooltip>
      <Tooltip content="Duplicate" shortcut="Ctrl+D">
        <ToolbarButton
          ariaLabel="Duplicate"
          onClick={() =>
            applyMutation({ type: "duplicate-element", nodeId: selectedNodeId })
          }
        >
          <Copy size={12} />
        </ToolbarButton>
      </Tooltip>
      <Tooltip content="Delete" shortcut="Del">
        <ToolbarButton
          ariaLabel="Delete"
          destructive
          onClick={() =>
            applyMutation({ type: "remove-element", nodeId: selectedNodeId })
          }
        >
          <Trash2 size={12} />
        </ToolbarButton>
      </Tooltip>

      {showAddChild && addBtnRef.current && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999]"
          style={{
            left: addBtnRef.current.getBoundingClientRect().left,
            top: addBtnRef.current.getBoundingClientRect().bottom + 4,
          }}
        >
          <AddElementPanel
            onSelect={handleAddChild}
            onClose={() => setShowAddChild(false)}
            componentsOnly={userMode === "marketer"}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

function findNode(
  nodes: import("@tve/shared").ASTNode[],
  targetId: string
): import("@tve/shared").ASTNode | null {
  for (const n of nodes) {
    if (n.nodeId === targetId) return n;
    const found = findNode(n.children, targetId);
    if (found) return found;
  }
  return null;
}

function computeToolbarCoords(
  iframeRect: DOMRect,
  sel: { x: number; y: number; width: number; height: number },
  tbWidth: number,
  tbHeight: number
): { top: number; left: number } {
  const inset = 4;
  const gap = 6;

  // Center horizontally over the selection. Clamp inside the iframe viewport
  // so small components near an edge keep the toolbar reachable.
  const selCenterX = iframeRect.left + sel.x + sel.width / 2;
  let left = selCenterX - tbWidth / 2;
  const minLeft = iframeRect.left + inset;
  const maxLeft = iframeRect.left + iframeRect.width - tbWidth - inset;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = Math.max(minLeft, maxLeft);

  const viewportTop = iframeRect.top + inset;
  const viewportBottom = iframeRect.top + iframeRect.height - inset;
  const selectionTop = iframeRect.top + sel.y;
  const selectionBottom = selectionTop + sel.height;
  const aboveTop = selectionTop - tbHeight - gap;
  const belowTop = selectionBottom + gap;
  const aboveFrameTop = iframeRect.top - tbHeight - gap;

  if (sel.width <= 1 && sel.height <= 1) {
    const cornerLeft = iframeRect.left + iframeRect.width - tbWidth - inset;
    return {
      top:
        aboveFrameTop >= inset
          ? aboveFrameTop
          : Math.max(viewportTop, viewportBottom - tbHeight),
      left: Math.max(minLeft, cornerLeft),
    };
  }

  let top: number;
  if (aboveTop >= viewportTop) {
    top = aboveTop;
  } else if (aboveFrameTop >= inset) {
    top = aboveFrameTop;
  } else if (belowTop + tbHeight <= viewportBottom) {
    top = belowTop;
  } else {
    // Last resort for selections that occupy most of the viewport: keep the
    // toolbar visible, even if there is no fully external position available.
    top = Math.min(
      Math.max(selectionTop + gap, viewportTop),
      viewportBottom - tbHeight
    );
  }

  return { top, left };
}

function ToolbarButton({
  children,
  onClick,
  ariaLabel,
  disabled,
  destructive,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  destructive?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        disabled
          ? "text-zinc-700 cursor-not-allowed"
          : destructive
            ? "text-zinc-300 hover:bg-red-500/20 hover:text-red-300"
            : accent
              ? "text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200"
            : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function findParent(
  nodes: import("@tve/shared").ASTNode[],
  targetId: string
): { parent: import("@tve/shared").ASTNode; index: number } | null {
  for (const n of nodes) {
    for (let i = 0; i < n.children.length; i++) {
      if (n.children[i].nodeId === targetId) return { parent: n, index: i };
    }
    const found = findParent(n.children, targetId);
    if (found) return found;
  }
  return null;
}
