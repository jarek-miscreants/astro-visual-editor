import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, Search, Focus, X } from "lucide-react";
import { ElementTree } from "../tree/ElementTree";
import { AddElementPanel } from "../tree/AddElementPanel";
import { useEditorStore } from "../../store/editor-store";
import { useModeStore } from "../../store/mode-store";
import { useTreeUIStore } from "../../store/tree-ui-store";
import { Tooltip } from "../ui/Tooltip";

export function LeftSidebar() {
  const ast = useEditorStore((s) => s.ast);
  const currentFile = useEditorStore((s) => s.currentFile);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const userMode = useModeStore((s) => s.userMode);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close add panel on click outside
  useEffect(() => {
    if (!showAddPanel) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        addBtnRef.current && !addBtnRef.current.contains(e.target as Node)
      ) {
        setShowAddPanel(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAddPanel(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showAddPanel]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const state = useEditorStore.getState();
      if (!state.selectedNodeId || !state.ast) return;

      // Don't intercept if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Delete — remove element
      if (e.key === "Delete") {
        e.preventDefault();
        state.applyMutation({ type: "remove-element", nodeId: state.selectedNodeId });
      }

      // Ctrl+D — duplicate
      if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        state.applyMutation({
          type: "duplicate-element",
          nodeId: state.selectedNodeId,
        });
      }

      const mode = useModeStore.getState().userMode;

      // Ctrl+E — open add element panel (dev only)
      if (e.ctrlKey && e.key === "e" && mode === "dev") {
        e.preventDefault();
        setShowAddPanel((prev) => !prev);
      }

      // Ctrl+Alt+G — wrap in div (dev only)
      if (e.ctrlKey && e.altKey && e.key === "g" && mode === "dev") {
        e.preventDefault();
        state.applyMutation({
          type: "wrap-element",
          nodeId: state.selectedNodeId,
          wrapperTag: "div",
        });
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function handleAddElement(html: string) {
    if (!selectedNodeId) return;
    applyMutation({
      type: "add-element",
      parentNodeId: selectedNodeId,
      position: useEditorStore.getState().nodeMap.get(selectedNodeId)?.children.length || 0,
      html,
    });
    setShowAddPanel(false);
  }

  const query = useTreeUIStore((s) => s.query);
  const setQuery = useTreeUIStore((s) => s.setQuery);
  const marketerZoom = useTreeUIStore((s) => s.marketerZoom);
  const toggleMarketerZoom = useTreeUIStore((s) => s.toggleMarketerZoom);

  return (
    <div className="flex h-full flex-col bg-zinc-950 border-r border-zinc-800">
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
        <span className="text-[11px] font-semibold text-zinc-200 tracking-tight">
          {userMode === "marketer" ? "Blocks" : "Elements"}
        </span>
        <div className="flex items-center gap-0.5">
          {userMode === "marketer" && (
            <Tooltip content={marketerZoom ? "Show full tree" : "Collapse to blocks only"}>
              <button
                onClick={toggleMarketerZoom}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                  marketerZoom
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                <Focus size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip
            content={userMode === "marketer" ? "Add component block" : "Add child element"}
            shortcut={userMode === "dev" ? "Ctrl+E" : undefined}
          >
            <button
              ref={addBtnRef}
              onClick={() => setShowAddPanel(!showAddPanel)}
              disabled={!selectedNodeId}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                selectedNodeId
                  ? "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                  : "text-zinc-700 cursor-not-allowed"
              }`}
            >
              <Plus size={13} />
            </button>
          </Tooltip>
          {showAddPanel && addBtnRef.current && createPortal(
            <div
              ref={panelRef}
              className="fixed z-[9999]"
              style={{
                left: addBtnRef.current.getBoundingClientRect().left,
                top: addBtnRef.current.getBoundingClientRect().bottom + 4,
              }}
            >
              <AddElementPanel
                onSelect={handleAddElement}
                onClose={() => setShowAddPanel(false)}
                componentsOnly={userMode === "marketer"}
              />
            </div>,
            document.body
          )}
          <Tooltip content="Delete element" shortcut="Del">
            <button
              onClick={() => {
                if (selectedNodeId) {
                  applyMutation({ type: "remove-element", nodeId: selectedNodeId });
                }
              }}
              disabled={!selectedNodeId}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                selectedNodeId
                  ? "text-zinc-400 hover:bg-zinc-900 hover:text-red-400"
                  : "text-zinc-700 cursor-not-allowed"
              }`}
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Search input */}
      <div className="border-b border-zinc-800 px-2 py-1.5">
        <div className="relative flex items-center">
          <Search size={11} className="absolute left-2 text-zinc-600" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tree…"
            className="w-full rounded border border-zinc-800 bg-zinc-900 pl-7 pr-6 py-1 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-1.5 text-zinc-600 hover:text-zinc-300"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1.5">
        {!currentFile ? (
          <p className="px-2 py-6 text-xs text-zinc-500 text-center">
            Select a page to edit
          </p>
        ) : !ast ? (
          <p className="px-2 py-6 text-xs text-zinc-500 text-center">
            Loading...
          </p>
        ) : (
          <ElementTree nodes={ast} depth={0} />
        )}
      </div>
    </div>
  );
}

