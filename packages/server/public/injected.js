var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  function createOverlay() {
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
    const hoverEl = createBoxElement("tve-hover", "rgba(59, 130, 246, 0.15)", "1px solid rgba(59, 130, 246, 0.6)");
    container.appendChild(hoverEl);
    const selectedEl = createBoxElement("tve-selected", "transparent", "2px solid #3b82f6");
    container.appendChild(selectedEl);
    const marginEl = createBoxElement("tve-margin", "rgba(251, 146, 60, 0.15)", "1px dashed rgba(251, 146, 60, 0.5)");
    container.appendChild(marginEl);
    const paddingEl = createBoxElement("tve-padding", "rgba(74, 222, 128, 0.15)", "1px dashed rgba(74, 222, 128, 0.5)");
    container.appendChild(paddingEl);
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
    let currentSelectedElement = null;
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
    function showGuides(rect, cs) {
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
    function placeLabel(el, rect, text) {
      if (!text) {
        el.style.display = "none";
        return;
      }
      el.textContent = text;
      el.style.display = "block";
      const labelH = el.offsetHeight || 18;
      const labelW = el.offsetWidth;
      const aboveTop = rect.top - labelH;
      const top = aboveTop < 0 ? rect.top : aboveTop;
      const maxLeft = Math.max(0, window.innerWidth - labelW - 4);
      const left = Math.min(Math.max(0, rect.left), maxLeft);
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
    }
    return {
      showHover(rect, label) {
        positionBox(hoverEl, rect);
        hoverEl.style.display = "block";
        placeLabel(hoverLabelEl, rect, label ?? "");
      },
      showSelected(rect, computedStyle, label) {
        positionBox(selectedEl, rect);
        selectedEl.style.display = "block";
        showGuides(rect, computedStyle);
        placeLabel(labelEl, rect, label ?? "");
      },
      showDropIndicator(rect, position) {
        dropIndicatorEl.style.display = "block";
        dropIndicatorEl.style.left = `${rect.left}px`;
        dropIndicatorEl.style.width = `${rect.width}px`;
        dropIndicatorEl.style.top = position === "before" ? `${rect.top}px` : `${rect.bottom}px`;
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
      }
    };
  }
  function createBoxElement(id, bg, border) {
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
  function positionBox(el, rect) {
    el.style.top = `${rect.top}px`;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }
  function setupInteraction(overlay, bridge, domMapper) {
    let selectedElement = null;
    let editMode = true;
    document.addEventListener(
      "click",
      (e) => {
        var _a;
        if (!editMode) return;
        const target = e.target;
        if (((_a = target.id) == null ? void 0 : _a.startsWith("tve-")) || target.closest("#tve-overlay")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
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
            classes: mappedEl.className,
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
              backgroundColor: cs.backgroundColor
            }
          }
        });
      },
      true
    );
    document.addEventListener(
      "mousemove",
      (e) => {
        var _a;
        if (!editMode) return;
        const target = e.target;
        if (((_a = target.id) == null ? void 0 : _a.startsWith("tve-")) || target.closest("#tve-overlay")) {
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
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
      },
      true
    );
    document.addEventListener("mouseleave", () => {
      overlay.clearHover();
      bridge.sendToEditor({
        type: "tve:hover",
        nodeId: null,
        tagName: "",
        rect: null
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        selectedElement = null;
        overlay.clear();
        bridge.sendToEditor({ type: "tve:deselect" });
      }
    });
    document.addEventListener(
      "submit",
      (e) => {
        if (editMode) e.preventDefault();
      },
      true
    );
    document.addEventListener(
      "dblclick",
      (e) => {
        var _a;
        if (!editMode) return;
        const target = e.target;
        if ((_a = target.id) == null ? void 0 : _a.startsWith("tve-")) return;
        e.preventDefault();
        e.stopPropagation();
        const mappedEl = domMapper.getClosestMappedElement(target);
        if (!mappedEl) return;
        const nodeId = domMapper.getNodeId(mappedEl);
        if (!nodeId) return;
        const text = getDirectTextContent(mappedEl);
        if (text === null) return;
        mappedEl.contentEditable = "true";
        mappedEl.focus();
        const finishEdit = () => {
          var _a2;
          mappedEl.contentEditable = "false";
          const newText = ((_a2 = mappedEl.textContent) == null ? void 0 : _a2.trim()) || "";
          bridge.sendToEditor({
            type: "tve:text-edit",
            nodeId,
            newText
          });
          mappedEl.removeEventListener("blur", finishEdit);
          mappedEl.removeEventListener("keydown", handleKey);
        };
        const handleKey = (e2) => {
          if (e2.key === "Enter" && !e2.shiftKey) {
            e2.preventDefault();
            mappedEl.blur();
          }
          if (e2.key === "Escape") {
            mappedEl.textContent = text;
            mappedEl.contentEditable = "false";
            mappedEl.removeEventListener("blur", finishEdit);
            mappedEl.removeEventListener("keydown", handleKey);
          }
        };
        mappedEl.addEventListener("blur", finishEdit);
        mappedEl.addEventListener("keydown", handleKey);
      },
      true
    );
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
        if (selectedElement === el) return;
        selectedElement = el;
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        overlay.clearHover();
        overlay.showSelected(rect, cs, formatElementLabel(el));
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }
  function formatElementLabel(el) {
    const isComponent = /^[A-Z]/.test(el.tagName);
    const tag = isComponent ? el.tagName : el.tagName.toLowerCase();
    const slot = el.getAttribute("slot");
    if (slot) return `${tag} · slot:${slot}`;
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean)[0];
    if (cls) return `${tag} · ${cls}`;
    return tag;
  }
  function getDirectTextContent(element) {
    var _a;
    const hasChildElements = element.querySelector(":scope > *") !== null;
    if (hasChildElements) return null;
    return ((_a = element.textContent) == null ? void 0 : _a.trim()) || null;
  }
  function getAttributes(element) {
    const attrs = {};
    for (const attr of Array.from(element.attributes)) {
      if (attr.name !== "class") {
        attrs[attr.name] = attr.value;
      }
    }
    return attrs;
  }
  function setupBridge(domMapper) {
    const handlers = [];
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data.type !== "string" || !data.type.startsWith("tve:")) {
        return;
      }
      if (data.type === "tve:provide-ast") {
        domMapper.setAst(data.ast);
        domMapper.remap();
        sendToEditor({
          type: "tve:dom-ready",
          nodeCount: domMapper.getNodeCount()
        });
        return;
      }
      if (data.type === "tve:update-classes") {
        const element = domMapper.getElementByNodeId(data.nodeId);
        if (element) {
          element.className = data.classes;
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
      if (data.type === "tve:highlight-node") {
        for (const handler of handlers) {
          handler(data);
        }
        return;
      }
      for (const handler of handlers) {
        handler(data);
      }
    });
    function sendToEditor(message) {
      window.parent.postMessage(message, "*");
    }
    return {
      sendToEditor,
      onMessage(handler) {
        handlers.push(handler);
      }
    };
  }
  class DomMapper {
    constructor() {
      __publicField(this, "ast", []);
      __publicField(this, "elementToNodeId", /* @__PURE__ */ new Map());
      __publicField(this, "nodeIdToElement", /* @__PURE__ */ new Map());
      /** For dynamic templates: nodeId → all matched DOM instances */
      __publicField(this, "nodeIdToInstances", /* @__PURE__ */ new Map());
    }
    setAst(ast) {
      this.ast = ast;
    }
    remap() {
      this.elementToNodeId.clear();
      this.nodeIdToElement.clear();
      this.nodeIdToInstances.clear();
      const body = document.body;
      if (!body) return;
      const bodyElements = this.getContentElements(body);
      this.matchChildren(this.ast, bodyElements);
      this.mapComponentsToDOM(this.ast);
      console.log(
        `[TVE DOM Mapper] Mapped ${this.elementToNodeId.size} elements (${this.nodeIdToInstances.size} dynamic templates)`
      );
    }
    /**
     * Match a list of AST nodes against a list of DOM elements.
     * Handles components (which render their own wrapper DOM element) by
     * consuming the next DOM element as the component's wrapper and searching
     * inside its subtree for slot content matches.
     */
    matchChildren(astNodes, domElements) {
      let domIndex = 0;
      for (const astNode of astNodes) {
        if (domIndex >= domElements.length) break;
        if (astNode.isComponent || this.isPascalCase(astNode.tagName)) {
          const consumed = this.matchComponent(astNode, domElements, domIndex);
          domIndex += consumed;
          continue;
        }
        if (astNode.isDynamic) {
          while (domIndex < domElements.length && domElements[domIndex].tagName.toLowerCase() !== astNode.tagName.toLowerCase()) {
            domIndex++;
          }
          const consumed = this.matchDynamicTemplate(astNode, domElements, domIndex);
          domIndex += consumed;
          continue;
        }
        while (domIndex < domElements.length) {
          const matched = this.tryMatchAt(astNode, domElements, domIndex);
          if (matched.success) {
            domIndex = matched.nextIndex;
            break;
          }
          domIndex++;
        }
      }
      return domIndex;
    }
    /**
     * Match an AST component node against DOM.
     * Two modes:
     *  - Transparent: the component renders its children inline (no wrapper).
     *    Detected when the next DOM element's tag+classes match the component's
     *    first non-component descendant.
     *  - Wrapping: the component renders its own wrapper around the slot.
     *    Consume the next DOM element as the wrapper, then search inside it
     *    for the best subtree to host the component's AST children.
     */
    matchComponent(astNode, domElements, startIndex) {
      if (startIndex >= domElements.length) return 0;
      const children = astNode.children;
      const nextDom = domElements[startIndex];
      const firstRealChild = this.firstNonComponentDescendant(children);
      let bestScore = 0;
      if (firstRealChild) {
        for (let i = startIndex; i < domElements.length; i++) {
          const s = this.scoreMatch(firstRealChild, domElements[i]);
          if (s > bestScore) bestScore = s;
        }
      }
      if (bestScore >= 2) {
        const beforeCount = this.elementToNodeId.size;
        const consumed = this.matchChildren(children, domElements.slice(startIndex));
        if (this.elementToNodeId.size > beforeCount && !this.nodeIdToElement.has(astNode.nodeId)) {
          const firstMapped = this.findFirstMappedDescendantEl(children);
          if (firstMapped) this.nodeIdToElement.set(astNode.nodeId, firstMapped);
        }
        return consumed;
      }
      this.elementToNodeId.set(nextDom, astNode.nodeId);
      this.nodeIdToElement.set(astNode.nodeId, nextDom);
      if (children.length > 0) {
        this.findAndMatchInSubtree(children, nextDom);
      }
      return 1;
    }
    /** BFS the wrapper's subtree for the best set of siblings to host astChildren. */
    findAndMatchInSubtree(astChildren, root) {
      const firstAst = this.firstNonComponentDescendant(astChildren);
      if (!firstAst) {
        const direct = this.getContentElements(root);
        if (direct.length > 0) this.matchChildren(astChildren, direct);
        return;
      }
      let bestChildren = null;
      let bestScore = 0;
      const walk = (el, depth) => {
        if (depth > 8) return;
        const siblings = this.getContentElements(el);
        if (siblings.length > 0) {
          const score = this.scoreMatch(firstAst, siblings[0]);
          if (score > bestScore) {
            bestScore = score;
            bestChildren = siblings;
          }
        }
        for (const child of siblings) walk(child, depth + 1);
      };
      walk(root, 0);
      if (bestChildren) {
        this.matchChildren(astChildren, bestChildren);
      }
    }
    /** First AST node in the subtree that isn't a component (i.e. renders as a DOM element). */
    firstNonComponentDescendant(nodes) {
      for (const node of nodes) {
        if (node.isComponent || this.isPascalCase(node.tagName)) {
          const found = this.firstNonComponentDescendant(node.children);
          if (found) return found;
        } else {
          return node;
        }
      }
      return null;
    }
    /** First DOM element reachable through already-mapped descendants. */
    findFirstMappedDescendantEl(nodes) {
      for (const node of nodes) {
        const el = this.nodeIdToElement.get(node.nodeId);
        if (el) return el;
        const deeper = this.findFirstMappedDescendantEl(node.children);
        if (deeper) return deeper;
      }
      return null;
    }
    /** Score a tag+class+attribute overlap. 0 means tag mismatch (reject). */
    scoreMatch(astNode, domEl) {
      if (astNode.tagName.toLowerCase() !== domEl.tagName.toLowerCase()) return 0;
      let score = 1;
      const astClasses = (astNode.classes || "").split(/\s+/).filter(Boolean);
      const domClassAttr = typeof domEl.className === "string" ? domEl.className : "";
      const domClassSet = new Set(domClassAttr.split(/\s+/).filter(Boolean));
      for (const cls of astClasses) {
        if (domClassSet.has(cls)) score += 2;
      }
      if (astNode.attributes) {
        for (const [key, val] of Object.entries(astNode.attributes)) {
          if (key === "class") continue;
          if (domEl.getAttribute(key) === val) score += 2;
        }
      }
      return score;
    }
    /**
     * Try to match a dynamic template node against multiple consecutive DOM elements.
     * Returns the number of DOM elements consumed.
     */
    matchDynamicTemplate(astNode, domElements, startIndex) {
      const instances = [];
      let i = startIndex;
      const targetTag = astNode.tagName.toLowerCase();
      while (i < domElements.length) {
        const domEl = domElements[i];
        if (domEl.tagName.toLowerCase() !== targetTag) break;
        instances.push(domEl);
        this.elementToNodeId.set(domEl, astNode.nodeId);
        i++;
      }
      if (instances.length > 0) {
        this.nodeIdToElement.set(astNode.nodeId, instances[0]);
        this.nodeIdToInstances.set(astNode.nodeId, instances);
        const childElements = this.getContentElements(instances[0]);
        if (astNode.children.length > 0 && childElements.length > 0) {
          this.matchChildren(astNode.children, childElements);
        }
      }
      return instances.length;
    }
    /**
     * Try to match a static AST node at the given DOM index.
     * Returns success and the next domIndex.
     */
    tryMatchAt(astNode, domElements, startIndex) {
      if (startIndex >= domElements.length) {
        return { success: false, nextIndex: startIndex };
      }
      const domEl = domElements[startIndex];
      if (domEl.tagName.toLowerCase() === astNode.tagName.toLowerCase()) {
        this.elementToNodeId.set(domEl, astNode.nodeId);
        this.nodeIdToElement.set(astNode.nodeId, domEl);
        const childElements = this.getContentElements(domEl);
        if (astNode.children.length > 0 && childElements.length > 0) {
          this.matchChildren(astNode.children, childElements);
        }
        return { success: true, nextIndex: startIndex + 1 };
      }
      return { success: false, nextIndex: startIndex };
    }
    /**
     * Map component nodes to their first rendered DOM element.
     * Allows clicking inside component-rendered content to find a target.
     */
    mapComponentsToDOM(nodes) {
      for (const node of nodes) {
        if ((node.isComponent || this.isPascalCase(node.tagName)) && node.children.length > 0) {
          const firstChild = this.flattenComponents(node.children)[0];
          if (firstChild) {
            const domEl = this.nodeIdToElement.get(firstChild.nodeId);
            if (domEl && !this.nodeIdToElement.has(node.nodeId)) {
              this.nodeIdToElement.set(node.nodeId, domEl);
            }
          }
        }
        if (node.children.length > 0) {
          this.mapComponentsToDOM(node.children);
        }
      }
    }
    flattenComponents(nodes) {
      const result = [];
      for (const node of nodes) {
        if (node.isComponent || this.isPascalCase(node.tagName)) {
          result.push(...this.flattenComponents(node.children));
        } else {
          result.push(node);
        }
      }
      return result;
    }
    isPascalCase(name) {
      return /^[A-Z]/.test(name);
    }
    /** Get meaningful child elements (skip script, style, tve overlay) */
    getContentElements(parent) {
      var _a;
      const elements = [];
      for (const child of Array.from(parent.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "link" || child.id === "tve-overlay" || ((_a = child.id) == null ? void 0 : _a.startsWith("tve-"))) {
          continue;
        }
        elements.push(child);
      }
      return elements;
    }
    getNodeId(element) {
      return this.elementToNodeId.get(element) || null;
    }
    getElementByNodeId(nodeId) {
      return this.nodeIdToElement.get(nodeId) || null;
    }
    /** Get all DOM instances for a node (for dynamic templates) */
    getInstances(nodeId) {
      return this.nodeIdToInstances.get(nodeId) || [];
    }
    getInstanceCount(nodeId) {
      var _a;
      return ((_a = this.nodeIdToInstances.get(nodeId)) == null ? void 0 : _a.length) ?? 1;
    }
    getNodeCount() {
      return this.elementToNodeId.size;
    }
    /** Find the closest mapped ancestor (or self) */
    getClosestMappedElement(element) {
      let current = element;
      while (current) {
        if (this.elementToNodeId.has(current)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }
  }
  (function tveInjected() {
    if (window.__tve_initialized) return;
    window.__tve_initialized = true;
    console.log("[TVE] Injected script loaded");
    const domMapper = new DomMapper();
    const overlay = createOverlay();
    const bridge = setupBridge(domMapper);
    setupInteraction(overlay, bridge, domMapper);
    window.__tve_provideAst = (ast) => {
      domMapper.setAst(ast);
      domMapper.remap();
      bridge.sendToEditor({
        type: "tve:dom-ready",
        nodeCount: domMapper.getNodeCount()
      });
    };
    bridge.sendToEditor({ type: "tve:ready" });
    document.addEventListener("astro:after-swap", () => {
      domMapper.remap();
      overlay.clear();
      bridge.sendToEditor({
        type: "tve:dom-ready",
        nodeCount: domMapper.getNodeCount()
      });
    });
  })();
})();
