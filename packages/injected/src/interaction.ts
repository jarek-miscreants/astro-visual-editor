import type { Overlay } from "./overlay";
import type { Bridge } from "./bridge";
import type { DomMapper } from "./dom-mapper";

export function setupInteraction(
  overlay: Overlay,
  bridge: Bridge,
  domMapper: DomMapper
) {
  let selectedElement: Element | null = null;
  let editMode = true;

  // Prevent all default navigation in edit mode
  document.addEventListener(
    "click",
    (e) => {
      if (!editMode) return;
      const target = e.target as Element;

      // Ignore overlay elements
      if (target.id?.startsWith("tve-") || target.closest("#tve-overlay")) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Find the closest mapped element
      const mappedEl = domMapper.getClosestMappedElement(target);
      if (!mappedEl) return;

      const nodeId = domMapper.getNodeId(mappedEl);
      if (!nodeId) return;

      selectedElement = mappedEl;
      const rect = mappedEl.getBoundingClientRect();
      const cs = getComputedStyle(mappedEl);

      overlay.clearHover();
      overlay.showSelected(rect, cs, formatElementLabel(mappedEl));

      bridge.sendToEditor({
        type: "tve:select",
        nodeId,
        elementInfo: {
          nodeId,
          tagName: mappedEl.tagName.toLowerCase(),
          // SVG elements expose `className` as an SVGAnimatedString rather
          // than a plain string; postMessage's structured-clone algorithm
          // can't transfer it and throws DataCloneError. Read via the
          // attribute instead so HTML and SVG behave the same.
          classes: mappedEl.getAttribute("class") ?? "",
          textContent: getDirectTextContent(mappedEl),
          attributes: getAttributes(mappedEl),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          computedStyles: {
            display: cs.display,
            position: cs.position,
            padding: cs.padding,
            margin: cs.margin,
            fontSize: cs.fontSize,
            color: cs.color,
            backgroundColor: cs.backgroundColor,
          },
        },
      });
    },
    true
  );

  // Hover highlighting
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!editMode) return;
      const target = e.target as Element;

      // Ignore overlay elements
      if (target.id?.startsWith("tve-") || target.closest("#tve-overlay")) {
        return;
      }

      const mappedEl = domMapper.getClosestMappedElement(target);
      if (!mappedEl || mappedEl === selectedElement) {
        overlay.clearHover();
        return;
      }

      const nodeId = domMapper.getNodeId(mappedEl);
      if (!nodeId) {
        overlay.clearHover();
        return;
      }

      const rect = mappedEl.getBoundingClientRect();
      overlay.showHover(rect, formatElementLabel(mappedEl));

      bridge.sendToEditor({
        type: "tve:hover",
        nodeId,
        tagName: mappedEl.tagName.toLowerCase(),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    },
    true
  );

  // Clear hover when mouse leaves viewport
  document.addEventListener("mouseleave", () => {
    overlay.clearHover();
    bridge.sendToEditor({
      type: "tve:hover",
      nodeId: null,
      tagName: "",
      rect: null,
    });
  });

  // Deselect on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      selectedElement = null;
      overlay.clear();
      bridge.sendToEditor({ type: "tve:deselect" });
    }
  });

  // Prevent default link/form behavior in edit mode
  document.addEventListener(
    "submit",
    (e) => {
      if (editMode) e.preventDefault();
    },
    true
  );

  // Handle double-click for inline text editing
  document.addEventListener(
    "dblclick",
    (e) => {
      if (!editMode) return;
      const target = e.target as Element;
      if (target.id?.startsWith("tve-")) return;

      e.preventDefault();
      e.stopPropagation();

      const mappedEl = domMapper.getClosestMappedElement(target);
      if (!mappedEl) return;

      const nodeId = domMapper.getNodeId(mappedEl);
      if (!nodeId) return;

      // Only allow text editing on elements with direct text content
      const text = getDirectTextContent(mappedEl);
      if (text === null) return;

      // Make it contenteditable temporarily
      (mappedEl as HTMLElement).contentEditable = "true";
      (mappedEl as HTMLElement).focus();

      const finishEdit = () => {
        (mappedEl as HTMLElement).contentEditable = "false";
        const newText = mappedEl.textContent?.trim() || "";
        bridge.sendToEditor({
          type: "tve:text-edit",
          nodeId,
          newText,
        });
        mappedEl.removeEventListener("blur", finishEdit);
        mappedEl.removeEventListener("keydown", handleKey);
      };

      const handleKey = (e: Event) => {
        if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) {
          e.preventDefault();
          (mappedEl as HTMLElement).blur();
        }
        if ((e as KeyboardEvent).key === "Escape") {
          // Restore original text
          mappedEl.textContent = text;
          (mappedEl as HTMLElement).contentEditable = "false";
          mappedEl.removeEventListener("blur", finishEdit);
          mappedEl.removeEventListener("keydown", handleKey);
        }
      };

      mappedEl.addEventListener("blur", finishEdit);
      mappedEl.addEventListener("keydown", handleKey);
    },
    true
  );

  // Handle messages from editor
  bridge.onMessage((message) => {
    if (message.type === "tve:set-mode") {
      editMode = message.mode === "edit";
      if (!editMode) {
        overlay.clear();
        selectedElement = null;
      }
    }

    if (message.type === "tve:highlight-node") {
      if (message.nodeId) {
        const el = domMapper.getElementByNodeId(message.nodeId);
        if (el) {
          const rect = el.getBoundingClientRect();
          overlay.showHover(rect);
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } else {
        overlay.clearHover();
      }
    }

    if (message.type === "tve:select-node") {
      if (!message.nodeId) {
        selectedElement = null;
        overlay.clear();
        return;
      }
      const el = domMapper.getElementByNodeId(message.nodeId);
      if (!el) return;
      if (selectedElement === el) return; // idempotent — avoids loop with tve:select round-trip
      selectedElement = el;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      overlay.clearHover();
      overlay.showSelected(rect, cs, formatElementLabel(el));
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

/** Build a user-facing label for an overlay pill:
 *   <Component>                   → "Component"
 *   <p slot="content">            → "p · slot:content"
 *   <h1 class="hero-title">       → "h1 · hero-title"
 *   <div class="x y z">           → "div · x"
 */
function formatElementLabel(el: Element): string {
  const isComponent = /^[A-Z]/.test(el.tagName);
  const tag = isComponent ? el.tagName : el.tagName.toLowerCase();
  const slot = el.getAttribute("slot");
  if (slot) return `${tag} · slot:${slot}`;
  const cls = (typeof el.className === "string" ? el.className : "")
    .split(/\s+/)
    .filter(Boolean)[0];
  if (cls) return `${tag} · ${cls}`;
  return tag;
}

/** Get direct text content of an element (only if it has no child elements) */
function getDirectTextContent(element: Element): string | null {
  const hasChildElements = element.querySelector(":scope > *") !== null;
  if (hasChildElements) return null;
  return element.textContent?.trim() || null;
}

/** Get all attributes of an element as a Record */
function getAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name !== "class") {
      attrs[attr.name] = attr.value;
    }
  }
  return attrs;
}
