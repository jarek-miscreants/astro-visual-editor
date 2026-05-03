import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Copy, Trash2, ArrowUp, ArrowDown, PlusCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../../store/editor-store";
import { Tooltip } from "../ui/Tooltip";
import { AddElementPanel } from "../tree/AddElementPanel";

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
  const applyMutation = useEditorStore((s) => s.applyMutation);

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

      // Center horizontally over the selection. Clamp inside the iframe
      // viewport so very small selections near the edges don't push the
      // toolbar offscreen.
      const selCenterX = iframeRect.left + sel.x + sel.width / 2;
      let left = selCenterX - tbWidth / 2;
      const minLeft = iframeRect.left + 4;
      const maxLeft = iframeRect.left + iframeRect.width - tbWidth - 4;
      if (left < minLeft) left = minLeft;
      if (left > maxLeft) left = Math.max(minLeft, maxLeft);

      // Vertical: place just above the selection. If there isn't room above
      // (selection touches the iframe top), drop the toolbar inside the
      // selection at its top edge so it stays visible without escaping.
      const aboveTop = iframeRect.top + sel.y - tbHeight - 6;
      const top = aboveTop >= iframeRect.top + 4
        ? aboveTop
        : iframeRect.top + sel.y + 6;
      setCoords({ top, left });
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
    const selCenterX = iframeRect.left + sel.x + sel.width / 2;
    let left = selCenterX - tbWidth / 2;
    const minLeft = iframeRect.left + 4;
    const maxLeft = iframeRect.left + iframeRect.width - tbWidth - 4;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = Math.max(minLeft, maxLeft);
    const aboveTop = iframeRect.top + sel.y - tbHeight - 6;
    const top = aboveTop >= iframeRect.top + 4
      ? aboveTop
      : iframeRect.top + sel.y + 6;
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

  function handleAddChild(html: string, options?: { componentPath?: string }) {
    if (!selectedNodeId) return;
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
      <Tooltip content="Add child">
        <button
          ref={addBtnRef}
          onClick={() => setShowAddChild((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <PlusCircle size={12} />
        </button>
      </Tooltip>
      <Tooltip content="Move up">
        <ToolbarButton
          disabled={!canMoveUp}
          onClick={() => moveSibling(-1)}
        >
          <ArrowUp size={12} />
        </ToolbarButton>
      </Tooltip>
      <Tooltip content="Move down">
        <ToolbarButton
          disabled={!canMoveDown}
          onClick={() => moveSibling(1)}
        >
          <ArrowDown size={12} />
        </ToolbarButton>
      </Tooltip>
      <Tooltip content="Duplicate" shortcut="Ctrl+D">
        <ToolbarButton
          onClick={() =>
            applyMutation({ type: "duplicate-element", nodeId: selectedNodeId })
          }
        >
          <Copy size={12} />
        </ToolbarButton>
      </Tooltip>
      <Tooltip content="Delete" shortcut="Del">
        <ToolbarButton
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

function ToolbarButton({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        disabled
          ? "text-zinc-700 cursor-not-allowed"
          : destructive
            ? "text-zinc-300 hover:bg-red-500/20 hover:text-red-300"
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
