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

  function handleAddElement(html: string, options?: { componentPath?: string }) {
    if (!selectedNodeId) return;
    applyMutation({
      type: "add-element",
      parentNodeId: selectedNodeId,
      position: useEditorStore.getState().nodeMap.get(selectedNodeId)?.children.length || 0,
      html,
      componentPath: options?.componentPath,
    });
    setShowAddPanel(false);
  }

  const query = useTreeUIStore((s) => s.query);
  const setQuery = useTreeUIStore((s) => s.setQuery);
  const marketerZoom = useTreeUIStore((s) => s.marketerZoom);
  const toggleMarketerZoom = useTreeUIStore((s) => s.toggleMarketerZoom);

  return (
    <div className="tve-panel tve-panel--left">
      <div className="tve-panel__header">
        <span className="tve-panel__title">
          {userMode === "marketer" ? "Blocks" : "Elements"}
        </span>
        <div className="tve-panel__actions">
          {userMode === "marketer" && (
            <Tooltip content={marketerZoom ? "Show full tree" : "Collapse to blocks only"}>
              <button
                onClick={toggleMarketerZoom}
                className={`tve-icon-btn tve-icon-btn--sm ${marketerZoom ? "tve-icon-btn--active" : ""}`}
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
              className="tve-icon-btn tve-icon-btn--sm"
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
              className="tve-icon-btn tve-icon-btn--sm tve-icon-btn--danger"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="tve-panel__section">
        <div className="tve-search">
          <Search size={11} className="tve-search__icon" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tree…"
            className="tve-search__input"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="tve-search__clear"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="tve-panel__body tve-panel__body--padded">
        {!currentFile ? (
          <p className="tve-panel__empty">Select a page to edit</p>
        ) : !ast ? (
          <p className="tve-panel__empty">Loading...</p>
        ) : (
          <ElementTree nodes={ast} depth={0} />
        )}
      </div>
    </div>
  );
}
