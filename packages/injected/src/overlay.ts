export interface Overlay {
  showHover(rect: DOMRect, label?: string): void;
  showSelected(rect: DOMRect, computedStyle: CSSStyleDeclaration, label?: string): void;
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

  // Label showing tag name above the selection
  const labelEl = document.createElement("div");
  labelEl.id = "tve-label";
  labelEl.style.cssText = `
    position: fixed;
    background: #3b82f6;
    color: white;
    font: 500 10px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
    padding: 2px 6px;
    border-radius: 4px 4px 0 0;
    display: none;
    pointer-events: none;
    z-index: 999999;
    white-space: nowrap;
    letter-spacing: 0.01em;
  `;
  container.appendChild(labelEl);

  // Hover label (slightly transparent, matches hover outline)
  const hoverLabelEl = document.createElement("div");
  hoverLabelEl.id = "tve-hover-label";
  hoverLabelEl.style.cssText = `
    position: fixed;
    background: rgba(59, 130, 246, 0.85);
    color: white;
    font: 500 10px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
    padding: 2px 6px;
    border-radius: 4px 4px 0 0;
    display: none;
    pointer-events: none;
    z-index: 999999;
    white-space: nowrap;
    letter-spacing: 0.01em;
  `;
  container.appendChild(hoverLabelEl);

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

  function placeLabel(el: HTMLElement, rect: DOMRect, text: string) {
    if (!text) {
      el.style.display = "none";
      return;
    }
    el.textContent = text;
    el.style.display = "block";
    // Measure after content assignment so height/width reflect the final text
    const labelH = el.offsetHeight || 18;
    const labelW = el.offsetWidth;
    // Default: sit above the selection, snapped to its left edge. Drop it
    // below if there's no space at the top.
    const aboveTop = rect.top - labelH;
    const top = aboveTop < 0 ? rect.top : aboveTop;
    // Keep the label within the viewport horizontally.
    const maxLeft = Math.max(0, window.innerWidth - labelW - 4);
    const left = Math.min(Math.max(0, rect.left), maxLeft);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  return {
    showHover(rect: DOMRect, label?: string) {
      positionBox(hoverEl, rect);
      hoverEl.style.display = "block";
      placeLabel(hoverLabelEl, rect, label ?? "");
    },

    showSelected(rect: DOMRect, computedStyle: CSSStyleDeclaration, label?: string) {
      positionBox(selectedEl, rect);
      selectedEl.style.display = "block";
      showGuides(rect, computedStyle);
      placeLabel(labelEl, rect, label ?? "");
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
      hoverLabelEl.style.display = "none";
      selectedEl.style.display = "none";
      marginEl.style.display = "none";
      paddingEl.style.display = "none";
      dropIndicatorEl.style.display = "none";
      labelEl.style.display = "none";
      currentSelectedElement = null;
    },

    clearHover() {
      hoverEl.style.display = "none";
      hoverLabelEl.style.display = "none";
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
