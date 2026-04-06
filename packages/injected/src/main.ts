import { createOverlay } from "./overlay";
import { setupInteraction } from "./interaction";
import { setupBridge } from "./bridge";
import { DomMapper } from "./dom-mapper";

(function tveInjected() {
  // Prevent double initialization
  if ((window as any).__tve_initialized) return;
  (window as any).__tve_initialized = true;

  console.log("[TVE] Injected script loaded");

  const domMapper = new DomMapper();
  const overlay = createOverlay();
  const bridge = setupBridge(domMapper);

  setupInteraction(overlay, bridge, domMapper);

  // Expose a global function that the parent can call to deliver AST
  // This avoids the postMessage timing race entirely
  (window as any).__tve_provideAst = (ast: any[]) => {
    domMapper.setAst(ast);
    domMapper.remap();
    bridge.sendToEditor({
      type: "tve:dom-ready",
      nodeCount: domMapper.getNodeCount(),
    });
  };

  // Notify parent that we're ready
  bridge.sendToEditor({ type: "tve:ready" });

  // Re-map DOM after Astro HMR updates
  document.addEventListener("astro:after-swap", () => {
    domMapper.remap();
    overlay.clear();
    bridge.sendToEditor({
      type: "tve:dom-ready",
      nodeCount: domMapper.getNodeCount(),
    });
  });

  // Also listen for Vite HMR
  if (import.meta.hot) {
    import.meta.hot.on("vite:afterUpdate", () => {
      setTimeout(() => {
        domMapper.remap();
        overlay.clear();
      }, 100);
    });
  }
})();
