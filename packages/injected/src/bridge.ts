import type { DomMapper } from "./dom-mapper";

export type IframeToEditorMessage =
  | { type: "tve:ready" }
  | {
      type: "tve:hover";
      nodeId: string | null;
      tagName: string;
      rect: { x: number; y: number; width: number; height: number } | null;
    }
  | {
      type: "tve:select";
      nodeId: string;
      elementInfo: {
        nodeId: string;
        tagName: string;
        classes: string;
        textContent: string | null;
        attributes: Record<string, string>;
        rect: { x: number; y: number; width: number; height: number };
        computedStyles: {
          display: string;
          position: string;
          padding: string;
          margin: string;
          fontSize: string;
          color: string;
          backgroundColor: string;
        };
      };
    }
  | { type: "tve:deselect" }
  | { type: "tve:text-edit"; nodeId: string; newText: string }
  | {
      type: "tve:move-element";
      nodeId: string;
      newParentId: string;
      newIndex: number;
    }
  | { type: "tve:dom-ready"; nodeCount: number };

export type EditorToIframeMessage =
  | { type: "tve:set-mode"; mode: "edit" | "preview" }
  | { type: "tve:highlight-node"; nodeId: string | null }
  | { type: "tve:select-node"; nodeId: string | null }
  | { type: "tve:update-classes"; nodeId: string; classes: string }
  | { type: "tve:update-text"; nodeId: string; text: string }
  | { type: "tve:refresh" }
  | { type: "tve:provide-ast"; ast: any[] };

export interface Bridge {
  sendToEditor(message: IframeToEditorMessage): void;
  onMessage(handler: (message: EditorToIframeMessage) => void): void;
}

export function setupBridge(domMapper: DomMapper): Bridge {
  const handlers: Array<(message: EditorToIframeMessage) => void> = [];

  // Listen for messages from the editor (parent window)
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data.type !== "string" || !data.type.startsWith("tve:")) {
      return;
    }

    // Handle AST provision
    if (data.type === "tve:provide-ast") {
      domMapper.setAst(data.ast);
      domMapper.remap();

      // Send back dom-ready
      sendToEditor({
        type: "tve:dom-ready",
        nodeCount: domMapper.getNodeCount(),
      });
      return;
    }

    // Handle class/text updates directly in the DOM for instant feedback
    if (data.type === "tve:update-classes") {
      const element = domMapper.getElementByNodeId(data.nodeId);
      if (element) {
        // `el.className = "..."` only works for HTML elements; on SVG
        // `className` is an SVGAnimatedString with no setter, so the
        // assignment throws. setAttribute works for both.
        element.setAttribute("class", data.classes);
      }
      return;
    }

    if (data.type === "tve:update-text") {
      const element = domMapper.getElementByNodeId(data.nodeId);
      if (element) {
        element.textContent = data.text;
      }
      return;
    }

    // Handle highlight requests
    if (data.type === "tve:highlight-node") {
      // Dispatch to handlers
      for (const handler of handlers) {
        handler(data as EditorToIframeMessage);
      }
      return;
    }

    for (const handler of handlers) {
      handler(data as EditorToIframeMessage);
    }
  });

  function sendToEditor(message: IframeToEditorMessage) {
    window.parent.postMessage(message, "*");
  }

  return {
    sendToEditor,
    onMessage(handler) {
      handlers.push(handler);
    },
  };
}
