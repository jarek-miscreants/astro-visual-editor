interface ASTNodeLike {
  nodeId: string;
  tagName: string;
  isComponent: boolean;
  isDynamic?: boolean;
  classes: string;
  attributes?: Record<string, string>;
  children: ASTNodeLike[];
}

/**
 * Maps live DOM elements to AST nodeIds by walking both trees in parallel.
 *
 * Handles three cases:
 * 1. Static elements: 1 AST node → 1 DOM element
 * 2. Components: AST node has no DOM (children render in parent's place)
 * 3. Dynamic templates (.map() loops): 1 AST node → N DOM elements
 */
export class DomMapper {
  private ast: ASTNodeLike[] = [];
  private elementToNodeId = new Map<Element, string>();
  private nodeIdToElement = new Map<string, Element>();
  /** For dynamic templates: nodeId → all matched DOM instances */
  private nodeIdToInstances = new Map<string, Element[]>();

  setAst(ast: ASTNodeLike[]) {
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

    // Map any components still unmapped to their first rendered descendant.
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
  private matchChildren(astNodes: ASTNodeLike[], domElements: Element[]) {
    let domIndex = 0;

    for (const astNode of astNodes) {
      if (domIndex >= domElements.length) break;

      if (astNode.isComponent || this.isPascalCase(astNode.tagName)) {
        const consumed = this.matchComponent(astNode, domElements, domIndex);
        domIndex += consumed;
        continue;
      }

      if (astNode.isDynamic) {
        while (
          domIndex < domElements.length &&
          domElements[domIndex].tagName.toLowerCase() !== astNode.tagName.toLowerCase()
        ) {
          domIndex++;
        }
        const consumed = this.matchDynamicTemplate(astNode, domElements, domIndex);
        domIndex += consumed;
        continue;
      }

      // Static element: skip unmatched DOM elements until we find a match
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
  private matchComponent(
    astNode: ASTNodeLike,
    domElements: Element[],
    startIndex: number
  ): number {
    if (startIndex >= domElements.length) return 0;
    const children = astNode.children;
    const nextDom = domElements[startIndex];

    // Transparent detection: if any DOM element ahead is a strong match for
    // the component's first rendered descendant, the component renders inline
    // (no wrapper) — match children at the current level.
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

    // Wrapping component: map to the wrapper element, then descend into it
    // to find slot content.
    this.elementToNodeId.set(nextDom, astNode.nodeId);
    this.nodeIdToElement.set(astNode.nodeId, nextDom);
    if (children.length > 0) {
      this.findAndMatchInSubtree(children, nextDom);
    }
    return 1;
  }

  /** BFS the wrapper's subtree for the best set of siblings to host
   *  astChildren. Then run a second pass to catch any AST children still
   *  unmapped — typical for components like CardIcon whose `<slot name="icon" />`
   *  and `<slot name="content" />` render into separate sub-divs of the
   *  wrapper, so the children aren't actually DOM siblings. */
  private findAndMatchInSubtree(astChildren: ASTNodeLike[], root: Element) {
    const firstAst = this.firstNonComponentDescendant(astChildren);
    if (!firstAst) {
      // All children are components — match them at the wrapper's direct content level.
      const direct = this.getContentElements(root);
      if (direct.length > 0) this.matchChildren(astChildren, direct);
    } else {
      let bestChildren: Element[] | null = null;
      let bestScore = 0;

      const walk = (el: Element, depth: number) => {
        if (depth > 8) return;
        const siblings = this.getContentElements(el);
        if (siblings.length > 0) {
          let score = this.scoreMatch(firstAst, siblings[0]);
          // Multi-child components (e.g. Grid with N CardFeatured) almost
          // never have firstAst directly match siblings[0] — the slot content
          // is buried multiple levels deep inside each sibling's wrapper. A
          // sibling list whose length matches the AST child count is itself
          // a strong signal that we've found the right level. Boost so it
          // wins over noisy 0-scores from deeper walks.
          if (
            astChildren.length > 1 &&
            siblings.length === astChildren.length
          ) {
            score += 3;
          }
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

    // Second pass: each unmapped child searches the wrapper subtree on its
    // own. Astro preserves the `slot=` attribute on user-passed slot
    // content, so scoreMatch can usually anchor on tag + classes + slot
    // attribute and find the right element.
    for (const astChild of astChildren) {
      if (this.nodeIdToElement.has(astChild.nodeId)) continue;
      this.matchAstChildAnywhere(astChild, root);
    }
  }

  /** Find the best DOM match for a single AST child anywhere in `root`'s
   *  subtree. For components, anchor on their first non-component
   *  descendant since components don't have a DOM tag of their own. */
  private matchAstChildAnywhere(astChild: ASTNodeLike, root: Element) {
    const target =
      astChild.isComponent || this.isPascalCase(astChild.tagName)
        ? this.firstNonComponentDescendant(astChild.children)
        : astChild;
    if (!target) return;

    let best: Element | null = null;
    let bestScore = 0;
    const walk = (el: Element, depth: number) => {
      if (depth > 10) return;
      if (!this.elementToNodeId.has(el)) {
        const s = this.scoreMatch(target, el);
        if (s > bestScore) {
          bestScore = s;
          best = el;
        }
      }
      for (const child of Array.from(el.children)) walk(child, depth + 1);
    };
    walk(root, 0);

    if (best && bestScore > 0) {
      this.elementToNodeId.set(best, astChild.nodeId);
      this.nodeIdToElement.set(astChild.nodeId, best);
      if (astChild.children.length > 0) {
        const childEls = this.getContentElements(best);
        if (childEls.length > 0) this.matchChildren(astChild.children, childEls);
      }
    }
  }

  /** First AST node in the subtree that isn't a component (i.e. renders as a DOM element). */
  private firstNonComponentDescendant(nodes: ASTNodeLike[]): ASTNodeLike | null {
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
  private findFirstMappedDescendantEl(nodes: ASTNodeLike[]): Element | null {
    for (const node of nodes) {
      const el = this.nodeIdToElement.get(node.nodeId);
      if (el) return el;
      const deeper = this.findFirstMappedDescendantEl(node.children);
      if (deeper) return deeper;
    }
    return null;
  }

  /** Score a tag+class+attribute overlap. 0 means tag mismatch (reject). */
  private scoreMatch(astNode: ASTNodeLike, domEl: Element): number {
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
  private matchDynamicTemplate(
    astNode: ASTNodeLike,
    domElements: Element[],
    startIndex: number
  ): number {
    const instances: Element[] = [];
    let i = startIndex;
    const targetTag = astNode.tagName.toLowerCase();

    // Match all consecutive DOM elements with the same tag
    while (i < domElements.length) {
      const domEl = domElements[i];
      if (domEl.tagName.toLowerCase() !== targetTag) break;
      instances.push(domEl);
      this.elementToNodeId.set(domEl, astNode.nodeId);
      i++;
    }

    if (instances.length > 0) {
      // Map the nodeId to the first instance + track all instances
      this.nodeIdToElement.set(astNode.nodeId, instances[0]);
      this.nodeIdToInstances.set(astNode.nodeId, instances);

      // Recursively map children of the template against the FIRST instance
      // (assumes all instances have similar structure)
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
  private tryMatchAt(
    astNode: ASTNodeLike,
    domElements: Element[],
    startIndex: number
  ): { success: boolean; nextIndex: number } {
    if (startIndex >= domElements.length) {
      return { success: false, nextIndex: startIndex };
    }

    const domEl = domElements[startIndex];
    if (domEl.tagName.toLowerCase() === astNode.tagName.toLowerCase()) {
      this.elementToNodeId.set(domEl, astNode.nodeId);
      this.nodeIdToElement.set(astNode.nodeId, domEl);

      // Recursively match children — pass raw AST children so matchChildren's
      // per-node component handling (wrapper detection) runs for each.
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
  private mapComponentsToDOM(nodes: ASTNodeLike[]) {
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

  private flattenComponents(nodes: ASTNodeLike[]): ASTNodeLike[] {
    const result: ASTNodeLike[] = [];
    for (const node of nodes) {
      if (node.isComponent || this.isPascalCase(node.tagName)) {
        result.push(...this.flattenComponents(node.children));
      } else {
        result.push(node);
      }
    }
    return result;
  }

  private isPascalCase(name: string): boolean {
    return /^[A-Z]/.test(name);
  }

  /** Get meaningful child elements (skip script, style, tve overlay) */
  private getContentElements(parent: Element): Element[] {
    const elements: Element[] = [];
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "link" ||
        child.id === "tve-overlay" ||
        child.id?.startsWith("tve-")
      ) {
        continue;
      }
      elements.push(child);
    }
    return elements;
  }

  getNodeId(element: Element): string | null {
    return this.elementToNodeId.get(element) || null;
  }

  getElementByNodeId(nodeId: string): Element | null {
    return this.nodeIdToElement.get(nodeId) || null;
  }

  /** Get all DOM instances for a node (for dynamic templates) */
  getInstances(nodeId: string): Element[] {
    return this.nodeIdToInstances.get(nodeId) || [];
  }

  getInstanceCount(nodeId: string): number {
    return this.nodeIdToInstances.get(nodeId)?.length ?? 1;
  }

  getNodeCount(): number {
    return this.elementToNodeId.size;
  }

  /** Find the closest mapped ancestor (or self) */
  getClosestMappedElement(element: Element): Element | null {
    let current: Element | null = element;
    while (current) {
      if (this.elementToNodeId.has(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}
