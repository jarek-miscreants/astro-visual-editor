export interface Overlay {
  showHover(rect: DOMRect): void;
  showSelected(rect: DOMRect, computedStyle: CSSStyleDeclaration): void;
  showDropIndicator(rect: DOMRect, position: "before" | "after"): void;
  clear(): void;
  clearHover(): void;
  clearSelected(): void;
  clearDropIndicator(): void;
}

export function createOverlay(): Overlay {
  // Create overlay container
  const container = document.createElement("div");
  container.id = "tve-overlay";
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999999;
  `;
  document.body.appendChild(container);

  // Hover highlight element
  const hoverEl = createBoxElement("tve-hover", "rgba(59, 130, 246, 0.15)", "1px solid rgba(59, 130, 246, 0.6)");
  container.appendChild(hoverEl);

  // Selected element highlight
  const selectedEl = createBoxElement("tve-selected", "transparent", "2px solid #3b82f6");
  container.appendChild(selectedEl);

  // Margin guides (orange)
  const marginEl = createBoxElement("tve-margin", "rgba(251, 146, 60, 0.15)", "1px dashed rgba(251, 146, 60, 0.5)");
  container.appendChild(marginEl);

  // Padding guides (green)
  const paddingEl = createBoxElement("tve-padding", "rgba(74, 222, 128, 0.15)", "1px dashed rgba(74, 222, 128, 0.5)");
  container.appendChild(paddingEl);

  // Drop indicator
  const dropIndicatorEl = document.createElement("div");
  dropIndicatorEl.id = "tve-drop-indicator";
  dropIndicatorEl.style.cssText = `
    position: fixed;
    height: 2px;
    background: #3b82f6;
    display: none;
    pointer-events: none;
    z-index: 999999;
  `;
  container.appendChild(dropIndicatorEl);

  // Label showing tag name
  const labelEl = document.createElement("div");
  labelEl.id = "tve-label";
  labelEl.style.cssText = `
    position: fixed;
    background: #3b82f6;
    color: white;
    font-size: 11px;
    font-family: system-ui, sans-serif;
    padding: 1px 6px;
    border-radius: 0 0 4px 0;
    display: none;
    pointer-events: none;
    z-index: 999999;
    white-space: nowrap;
  `;
  container.appendChild(labelEl);

  // Update overlay positions on scroll/resize
  let currentSelectedElement: Element | null = null;

  function updatePositions() {
    if (currentSelectedElement) {
      const rect = currentSelectedElement.getBoundingClientRect();
      const cs = getComputedStyle(currentSelectedElement);
      positionBox(selectedEl, rect);
      showGuides(rect, cs);
    }
  }

  window.addEventListener("scroll", updatePositions, true);
  window.addEventListener("resize", updatePositions);

  function showGuides(rect: DOMRect, cs: CSSStyleDeclaration) {
    const mt = parseFloat(cs.marginTop) || 0;
    const mr = parseFloat(cs.marginRight) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    const ml = parseFloat(cs.marginLeft) || 0;

    if (mt || mr || mb || ml) {
      marginEl.style.display = "block";
      marginEl.style.top = `${rect.top - mt}px`;
      marginEl.style.left = `${rect.left - ml}px`;
      marginEl.style.width = `${rect.width + ml + mr}px`;
      marginEl.style.height = `${rect.height + mt + mb}px`;
    } else {
      marginEl.style.display = "none";
    }

    const pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;

    if (pt || pr || pb || pl) {
      paddingEl.style.display = "block";
      paddingEl.style.top = `${rect.top + pt}px`;
      paddingEl.style.left = `${rect.left + pl}px`;
      paddingEl.style.width = `${rect.width - pl - pr}px`;
      paddingEl.style.height = `${rect.height - pt - pb}px`;
    } else {
      paddingEl.style.display = "none";
    }
  }

  return {
    showHover(rect: DOMRect) {
      positionBox(hoverEl, rect);
      hoverEl.style.display = "block";
    },

    showSelected(rect: DOMRect, computedStyle: CSSStyleDeclaration) {
      positionBox(selectedEl, rect);
      selectedEl.style.display = "block";
      showGuides(rect, computedStyle);

      labelEl.style.display = "block";
      labelEl.style.top = `${rect.top}px`;
      labelEl.style.left = `${rect.left}px`;
    },

    showDropIndicator(rect: DOMRect, position: "before" | "after") {
      dropIndicatorEl.style.display = "block";
      dropIndicatorEl.style.left = `${rect.left}px`;
      dropIndicatorEl.style.width = `${rect.width}px`;
      dropIndicatorEl.style.top =
        position === "before"
          ? `${rect.top}px`
          : `${rect.bottom}px`;
    },

    clear() {
      hoverEl.style.display = "none";
      selectedEl.style.display = "none";
      marginEl.style.display = "none";
      paddingEl.style.display = "none";
      dropIndicatorEl.style.display = "none";
      labelEl.style.display = "none";
      currentSelectedElement = null;
    },

    clearHover() {
      hoverEl.style.display = "none";
    },

    clearSelected() {
      selectedEl.style.display = "none";
      marginEl.style.display = "none";
      paddingEl.style.display = "none";
      labelEl.style.display = "none";
      currentSelectedElement = null;
    },

    clearDropIndicator() {
      dropIndicatorEl.style.display = "none";
    },
  };
}

function createBoxElement(id: string, bg: string, border: string): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  el.style.cssText = `
    position: fixed;
    display: none;
    pointer-events: none;
    background: ${bg};
    border: ${border};
    z-index: 999999;
  `;
  return el;
}

function positionBox(el: HTMLElement, rect: DOMRect) {
  el.style.top = `${rect.top}px`;
  el.style.left = `${rect.left}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}
