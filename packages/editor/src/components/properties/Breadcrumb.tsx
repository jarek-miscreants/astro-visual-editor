import { ChevronRight } from "lucide-react";
import type { ASTNode } from "@tve/shared";
import { useEditorStore } from "../../store/editor-store";
import { highlightNodeInIframe } from "../../lib/iframe-bridge";

/** Walk the AST looking for the path from root to the node with the given id. */
function findPath(nodes: ASTNode[], targetId: string, trail: ASTNode[] = []): ASTNode[] | null {
  for (const n of nodes) {
    const next = [...trail, n];
    if (n.nodeId === targetId) return next;
    const found = findPath(n.children, targetId, next);
    if (found) return found;
  }
  return null;
}

interface Props {
  nodeId: string;
}

export function Breadcrumb({ nodeId }: Props) {
  const ast = useEditorStore((s) => s.ast);
  const selectNode = useEditorStore((s) => s.selectNode);
  if (!ast) return null;
  const path = findPath(ast, nodeId);
  if (!path || path.length === 0) return null;

  function makeElementInfo(n: ASTNode) {
    return {
      nodeId: n.nodeId,
      tagName: n.tagName,
      classes: n.classes,
      textContent: n.textContent,
      attributes: n.attributes,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      computedStyles: {
        display: "", position: "", padding: "",
        margin: "", fontSize: "", color: "", backgroundColor: "",
      },
    };
  }

  return (
    <div className="tve-prop-breadcrumb">
      {path.map((n, i) => {
        const last = i === path.length - 1;
        const isComp = n.isComponent || /^[A-Z]/.test(n.tagName);
        return (
          <div key={n.nodeId} className="tve-prop-crumb-row">
            {i > 0 && <ChevronRight size={9} className="tve-prop-crumb-sep" />}
            <button
              onClick={() => {
                selectNode(n.nodeId, makeElementInfo(n));
                highlightNodeInIframe(n.nodeId);
              }}
              className="tve-prop-crumb"
              data-current={last ? (isComp ? "component" : "tag") : undefined}
            >
              {n.tagName}
            </button>
          </div>
        );
      })}
    </div>
  );
}
