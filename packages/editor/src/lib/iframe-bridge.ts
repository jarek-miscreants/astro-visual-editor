import type {
  IframeToEditorMessage,
  EditorToIframeMessage,
  ASTNode,
} from "@tve/shared";

export type IframeMessageHandler = (message: IframeToEditorMessage) => void;

const handlers = new Set<IframeMessageHandler>();
let listenerActive = false;

function ensureListener() {
  if (!listenerActive) {
    window.addEventListener("message", handleMessage);
    listenerActive = true;
  }
}

function handleMessage(event: MessageEvent) {
  const data = event.data;
  if (!data || typeof data.type !== "string" || !data.type.startsWith("tve:")) {
    return;
  }
  for (const handler of handlers) {
    handler(data as IframeToEditorMessage);
  }
}

/** Listen for messages from the iframe */
export function onIframeMessage(handler: IframeMessageHandler): () => void {
  handlers.add(handler);
  ensureListener();
  return () => { handlers.delete(handler); };
}

/** Find the current iframe element in the DOM */
function getIframe(): HTMLIFrameElement | null {
  return document.querySelector('iframe[title="Page Preview"]');
}

/** Send a message to the iframe */
export function sendToIframe(message: EditorToIframeMessage) {
  const iframe = getIframe();
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(message, "*");
  }
}

/**
 * Send the AST to the iframe for DOM mapping.
 * Uses two strategies:
 * 1. postMessage (works if bridge listener is registered)
 * 2. Direct global function call (bypasses message timing entirely)
 */
export function provideAstToIframe(ast: ASTNode[]) {
  const iframe = getIframe();
  if (!iframe) return;

  // Strategy 1: postMessage
  sendToIframe({ type: "tve:provide-ast", ast });

  // Strategy 2: direct call via exposed global (iframe must be same-origin)
  try {
    const iframeWindow = iframe.contentWindow as any;
    if (iframeWindow?.__tve_provideAst) {
      iframeWindow.__tve_provideAst(ast);
    }
  } catch {
    // Cross-origin — postMessage is the only option
  }
}

/** Update classes on an element in the iframe (instant feedback) */
export function updateClassesInIframe(nodeId: string, classes: string) {
  sendToIframe({ type: "tve:update-classes", nodeId, classes });
}

/** Update text content in the iframe */
export function updateTextInIframe(nodeId: string, text: string) {
  sendToIframe({ type: "tve:update-text", nodeId, text });
}

/** Highlight a node in the iframe (hover-style outline) */
export function highlightNodeInIframe(nodeId: string | null) {
  sendToIframe({ type: "tve:highlight-node", nodeId });
}

/** Set the iframe's selected element (persistent selection outline) */
export function selectNodeInIframe(nodeId: string | null) {
  sendToIframe({ type: "tve:select-node", nodeId });
}
