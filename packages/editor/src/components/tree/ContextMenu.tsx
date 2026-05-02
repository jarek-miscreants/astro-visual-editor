import { useEffect, useRef, useState } from "react";
import {
  Plus,
  PlusCircle,
  Copy,
  Trash2,
  WrapText,
  ArrowUp,
  ArrowDown,
  Component,
} from "lucide-react";
import type { ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { AddElementPanel } from "./AddElementPanel";
import { ComponentDialog } from "../dialogs/ComponentDialog";

interface ContextMenuProps {
  node: ASTNode;
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ node, x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showAddPanel, setShowAddPanel] = useState<"child" | "before" | "after" | null>(null);
  const [showExtract, setShowExtract] = useState(false);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const ast = useEditorStore((s) => s.ast);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function findParent(nodes: ASTNode[], targetId: string): { parent: ASTNode; index: number } | null {
    for (const n of nodes) {
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

  function handleDelete() {
    applyMutation({ type: "remove-element", nodeId: node.nodeId });
    onClose();
  }

  function handleDuplicate() {
    applyMutation({ type: "duplicate-element", nodeId: node.nodeId });
    onClose();
  }

  function handleWrapInDiv() {
    applyMutation({ type: "wrap-element", nodeId: node.nodeId, wrapperTag: "div" });
    onClose();
  }

  function handleAddElement(html: string, options?: { componentPath?: string }) {
    if (!ast) return;

    if (showAddPanel === "child") {
      applyMutation({
        type: "add-element",
        parentNodeId: node.nodeId,
        position: node.children.length,
        html,
        componentPath: options?.componentPath,
      });
    } else if (showAddPanel === "before" || showAddPanel === "after") {
      const parentInfo = findParent(ast, node.nodeId);
      if (!parentInfo) return;
      const pos = showAddPanel === "before" ? parentInfo.index : parentInfo.index + 1;
      applyMutation({
        type: "add-element",
        parentNodeId: parentInfo.parent.nodeId,
        position: pos,
        html,
        componentPath: options?.componentPath,
      });
    }
    onClose();
  }

  if (showExtract) {
    return (
      <ComponentDialog
        mode="extract"
        nodeId={node.nodeId}
        onClose={onClose}
      />
    );
  }

  if (showAddPanel) {
    return (
      <div ref={ref} className="fixed z-[9999]" style={{ left: x, top: y }}>
        <AddElementPanel
          onSelect={handleAddElement}
          onClose={onClose}
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[180px]  border border-zinc-700 bg-zinc-800 py-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      <MenuHeader label={`<${node.tagName}>`} />

      <MenuItem
        icon={<PlusCircle size={12} />}
        label="Add child"
        onClick={() => setShowAddPanel("child")}
      />
      <MenuItem
        icon={<ArrowUp size={12} />}
        label="Add before"
        onClick={() => setShowAddPanel("before")}
      />
      <MenuItem
        icon={<ArrowDown size={12} />}
        label="Add after"
        onClick={() => setShowAddPanel("after")}
      />

      <MenuDivider />

      <MenuItem
        icon={<Copy size={12} />}
        label="Duplicate"
        shortcut="Ctrl+D"
        onClick={handleDuplicate}
      />
      <MenuItem
        icon={<WrapText size={12} />}
        label="Wrap in div"
        onClick={handleWrapInDiv}
      />

      <MenuDivider />

      <MenuItem
        icon={<Component size={12} />}
        label="Extract to component"
        onClick={() => setShowExtract(true)}
      />

      <MenuDivider />

      <MenuItem
        icon={<Trash2 size={12} />}
        label="Delete"
        shortcut="Del"
        onClick={handleDelete}
        danger
      />
    </div>
  );
}

function MenuHeader({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 text-[10px] font-mono text-zinc-500">
      {label}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <span className="ml-auto text-[10px] text-zinc-500">{shortcut}</span>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-zinc-700" />;
}
