import { createOverlay } from "./overlay";
import { setupInteraction } from "./interaction";
import { setupBridge } from "./bridge";
import { DomMapper } from "./dom-mapper";

(function tveInjected() {
  // Prevent double initialization
  if ((window as any).__tve_initialized) return;
  (window as any).__tve_initialized = true;

  console.log("[TVE] Injected script loaded");

  // Preserve scroll position across Astro HMR reloads. Editing an .astro file
  // forces a full page reload (Astro doesn't module-HMR .astro), which would
  // otherwise drop the iframe back to the top after every mutation. Persist
  // scrollX/Y in sessionStorage keyed by pathname (so navigating between
  // pages doesn't bleed positions) and restore on init.
  const SCROLL_KEY = `__tve_scroll:${location.pathname}`;
  // Tell the browser not to do its own restoration — we own it.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const saved = sessionStorage.getItem(SCROLL_KEY);
  if (saved) {
    try {
      const { x, y } = JSON.parse(saved);
      // Restore once the document is laid out. requestAnimationFrame would
      // fire before late-loading content (images, fonts) settles its height,
      // so try a few times with a short window — bail out as soon as the
      // target is actually reachable.
      const tryRestore = (attempt: number) => {
        const max = Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0
        ) - window.innerHeight;
        const target = Math.min(y, Math.max(0, max));
        window.scrollTo(x, target);
        if (window.scrollY < y - 4 && attempt < 30) {
          requestAnimationFrame(() => tryRestore(attempt + 1));
        }
      };
      requestAnimationFrame(() => tryRestore(0));
    } catch {
      /* ignore malformed entry */
    }
  }
  let scrollSaveTimer: number | undefined;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollSaveTimer !== undefined) window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = window.setTimeout(() => {
        sessionStorage.setItem(
          SCROLL_KEY,
          JSON.stringify({ x: window.scrollX, y: window.scrollY })
        );
      }, 100);
    },
    { passive: true }
  );

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
