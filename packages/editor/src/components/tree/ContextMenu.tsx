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
    if (!ast) return;
    const parentInfo = findParent(ast, node.nodeId);
    if (!parentInfo) return;

    // Rebuild the HTML from the node (simplified — uses tag + classes + content)
    const html = nodeToHtml(node);
    applyMutation({
      type: "add-element",
      parentNodeId: parentInfo.parent.nodeId,
      position: parentInfo.index + 1,
      html,
    });
    onClose();
  }

  function handleWrapInDiv() {
    // Wrap = add a div parent, move this element into it
    // For simplicity: delete element, add div with element's HTML as inner content
    if (!ast) return;
    const parentInfo = findParent(ast, node.nodeId);
    if (!parentInfo) return;

    const innerHtml = nodeToHtml(node);
    // Remove old element
    applyMutation({ type: "remove-element", nodeId: node.nodeId });
    // Add wrapped version
    setTimeout(() => {
      applyMutation({
        type: "add-element",
        parentNodeId: parentInfo.parent.nodeId,
        position: parentInfo.index,
        html: `<div>\n  ${innerHtml}\n</div>`,
      });
    }, 100);
    onClose();
  }

  function handleAddElement(html: string) {
    if (!ast) return;

    if (showAddPanel === "child") {
      applyMutation({
        type: "add-element",
        parentNodeId: node.nodeId,
        position: node.children.length,
        html,
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

/** Convert an AST node back to a simple HTML string (for duplicate/wrap) */
function nodeToHtml(node: ASTNode): string {
  const attrs: string[] = [];
  if (node.classes) attrs.push(`class="${node.classes}"`);
  for (const [key, value] of Object.entries(node.attributes)) {
    attrs.push(`${key}="${value}"`);
  }
  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

  if (["img", "input", "br", "hr"].includes(node.tagName)) {
    return `<${node.tagName}${attrStr} />`;
  }

  let inner = "";
  if (node.textContent) {
    inner = node.textContent;
  } else if (node.children.length > 0) {
    inner = "\n" + node.children.map((c) => "  " + nodeToHtml(c)).join("\n") + "\n";
  }

  return `<${node.tagName}${attrStr}>${inner}</${node.tagName}>`;
}
