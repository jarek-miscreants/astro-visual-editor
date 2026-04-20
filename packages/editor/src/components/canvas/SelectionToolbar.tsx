import { useEffect, useState, type RefObject } from "react";
import { Copy, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";
import { Tooltip } from "../ui/Tooltip";

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
      // Position toolbar at top-right corner of selection, outside the iframe.
      const top = iframeRect.top + sel.y - 38;
      const left = iframeRect.left + sel.x + sel.width;
      setCoords({ top: Math.max(4, top), left });
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

  return (
    <div
      className="fixed z-[60] flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 p-0.5 shadow-lg shadow-black/30 backdrop-blur"
      style={{ top: coords.top, left: coords.left }}
    >
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
    </div>
  );
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
