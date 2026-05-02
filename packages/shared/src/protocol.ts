import type { ASTNode, ElementInfo, DevServerStartError } from "./types.js";

/** Messages sent from the injected iframe script to the editor */
export type IframeToEditorMessage =
  | { type: "tve:ready" }
  | {
      type: "tve:hover";
      nodeId: string | null;
      tagName: string;
      rect: { x: number; y: number; width: number; height: number } | null;
    }
  | { type: "tve:select"; nodeId: string; elementInfo: ElementInfo }
  | { type: "tve:deselect" }
  | { type: "tve:text-edit"; nodeId: string; newText: string }
  | {
      type: "tve:move-element";
      nodeId: string;
      newParentId: string;
      newIndex: number;
    }
  | { type: "tve:dom-ready"; nodeCount: number };

/** Messages sent from the editor to the injected iframe script */
export type EditorToIframeMessage =
  | { type: "tve:set-mode"; mode: "edit" | "preview" }
  | { type: "tve:highlight-node"; nodeId: string | null }
  | { type: "tve:select-node"; nodeId: string | null }
  | { type: "tve:update-classes"; nodeId: string; classes: string }
  | { type: "tve:update-text"; nodeId: string; text: string }
  | { type: "tve:refresh" }
  | { type: "tve:provide-ast"; ast: ASTNode[] };

/** WebSocket events from server to client */
export type ServerWsMessage =
  | { type: "file:changed"; path: string; ast: ASTNode[] }
  | { type: "dev-server:ready"; url: string }
  | { type: "dev-server:log"; line: string }
  | { type: "dev-server:error"; message: string; error?: DevServerStartError };

/** WebSocket events from client to server */
export type ClientWsMessage =
  | { type: "file:subscribe"; path: string }
  | { type: "mutation:apply"; path: string; mutation: import("./types.js").Mutation };
