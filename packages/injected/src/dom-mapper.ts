interface ASTNodeLike {
  nodeId: string;
  tagName: string;
  isComponent: boolean;
  isDynamic?: boolean;
  classes: string;
  attributes?: Record<string, string>;
  renderTarget?: "body" | "head";
  /** Trimmed text of a text-only node (set by the parser when the element has
   *  a single text child). Used as a tiebreaker in scoreMatch so two siblings
   *  with identical tag+classes can still be told apart by their copy. */
  textContent?: string | null;
  children: ASTNodeLike[];
}

/** Normalize text for comparison: trim and collapse internal whitespace runs
 *  to single spaces, so AST copy (parser-trimmed) and DOM textContent (which
 *  may carry indentation/newlines from the template) compare equal. */
function normalizeText(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
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
      if (!this.rendersInBody(astNode)) continue;
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

      // Static element: find the best same-tag DOM element from here on.
      // When the AST node has element children, prefer a candidate whose
      // subtree can actually host them (has content children) over an empty,
      // decorative element of the same tag. This matters for classless wrapper
      // divs: e.g. a page `<div>` whose component renders it as the slot of a
      // grid section sitting between two empty `section-pattern` divs — binding
      // to the first (empty) one strands the whole subtree unmapped. Fall back
      // to the first tag match if none has children, preserving prior behavior.
      const needsChildren = astNode.children.length > 0;
      let fallbackIndex = -1;
      let chosenIndex = -1;
      for (let i = domIndex; i < domElements.length; i++) {
        if (
          domElements[i].tagName.toLowerCase() !== astNode.tagName.toLowerCase()
        ) {
          continue;
        }
        if (fallbackIndex === -1) fallbackIndex = i;
        if (!needsChildren || this.getContentElements(domElements[i]).length > 0) {
          chosenIndex = i;
          break;
        }
      }
      const matchIndex = chosenIndex !== -1 ? chosenIndex : fallbackIndex;
      if (matchIndex !== -1) {
        const matched = this.tryMatchAt(astNode, domElements, matchIndex);
        domIndex = matched.success ? matched.nextIndex : matchIndex + 1;
      } else {
        // No same-tag candidate remains — give up on this node (and, as before,
        // the rest, since later siblings can't appear before an unmatched one).
        domIndex = domElements.length;
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

    // A class match scores +2, so the usual `>= 2` gate effectively requires
    // the first child to share a class with a sibling. That fails when the
    // child is a classless landmark (e.g. `<main>` with no class), which
    // scores only +1 (tag-only) — the component then gets misread as a
    // wrapper and consumes the wrong DOM element, leaving the whole subtree
    // unmapped. So also accept a tag-only match when the child carries no
    // classes (a class match is impossible) AND that tag is unique among the
    // candidate siblings, making it a reliable anchor.
    const childHasNoClasses =
      !!firstRealChild && !(firstRealChild.classes || "").trim();
    const tagOnlyAnchor =
      childHasNoClasses &&
      bestScore >= 1 &&
      domElements.filter(
        (el, i) =>
          i >= startIndex &&
          el.tagName.toLowerCase() === firstRealChild!.tagName.toLowerCase()
      ).length === 1;

    if (bestScore >= 2 || tagOnlyAnchor) {
      const beforeCount = this.elementToNodeId.size;
      const consumed = this.matchChildren(children, domElements.slice(startIndex));
      if (this.elementToNodeId.size > beforeCount && !this.nodeIdToElement.has(astNode.nodeId)) {
        const firstMapped = this.findFirstMappedDescendantEl(children);
        if (firstMapped) this.nodeIdToElement.set(astNode.nodeId, firstMapped);
      }
      return consumed;
    }

    // Wrapping component: map to the wrapper element, then descend into it
    // to find slot content. The naive wrapper is the next sibling, but a
    // component often renders its content among DECORATIVE siblings — e.g.
    // SectionMain emits `<div aria-hidden="true" class="section-pattern">`
    // flanking the slot's content div. Binding the component to an empty
    // aria-hidden decorator means the visible content isn't a DOM descendant
    // of the mapped element, so clicking it can't resolve back to the
    // component (it's selectable in the tree but not the iframe). Prefer the
    // first candidate from startIndex that is content-bearing and not
    // aria-hidden; fall back to the next sibling when none qualifies.
    let wrapperIndex = startIndex;
    for (let i = startIndex; i < domElements.length; i++) {
      const cand = domElements[i];
      if (cand.getAttribute("aria-hidden") === "true") continue;
      const hasContent =
        this.getContentElements(cand).length > 0 ||
        (cand.textContent ?? "").trim().length > 0;
      if (hasContent) {
        wrapperIndex = i;
        break;
      }
    }
    const wrapper = domElements[wrapperIndex];
    this.elementToNodeId.set(wrapper, astNode.nodeId);
    this.nodeIdToElement.set(astNode.nodeId, wrapper);
    if (children.length > 0) {
      this.findAndMatchInSubtree(children, wrapper);
    }
    // Consume through the chosen wrapper so any decorative siblings we skipped
    // don't get re-matched to a later AST node.
    return wrapperIndex - startIndex + 1;
  }

  /** BFS the wrapper's subtree for the best set of siblings to host
   *  astChildren. Then run a second pass to catch any AST children still
   *  unmapped — typical for components like CardIcon whose `<slot name="icon" />`
   *  and `<slot name="content" />` render into separate sub-divs of the
   *  wrapper, so the children aren't actually DOM siblings. */
  private findAndMatchInSubtree(astChildren: ASTNodeLike[], root: Element) {
    const firstAst = this.firstNonComponentDescendant(astChildren);
    const preferredChildren = this.preferredSlotChildren(astChildren, root);
    let matchedPreferredLevel = false;

    if (preferredChildren.length > 0) {
      const beforeCount = this.elementToNodeId.size;
      this.matchChildren(astChildren, preferredChildren);
      matchedPreferredLevel =
        this.elementToNodeId.size > beforeCount ||
        astChildren.some((child) => this.nodeIdToElement.has(child.nodeId));
    }

    if (matchedPreferredLevel) {
      // The component's immediate slot/wrapper level matched. Do not let the
      // deep fuzzy pass re-bind a component like <Grid> to a descendant <img>.
    } else if (!firstAst) {
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
      if (!this.rendersInBody(astChild)) continue;
      if (this.nodeIdToElement.has(astChild.nodeId)) continue;
      this.matchAstChildAnywhere(astChild, root);
    }
  }

  /**
   * Prefer the DOM level that most likely corresponds to slotted child
   * components before falling back to fuzzy deep matching.
   *
   * Example: SectionMain renders `section > decorative + content + decorative`;
   * the page AST has a single child component `<Grid>`, and Grid itself renders
   * a real wrapper `<div class="grid ...">`. A deep search sees Grid's first
   * slotted image and can incorrectly map Grid to `<img>`. This helper chooses
   * the content wrapper's direct children (`[div.grid]`) first.
   */
  private preferredSlotChildren(astChildren: ASTNodeLike[], root: Element): Element[] {
    if (astChildren.length === 0) return [];
    const direct = this.getContentElements(root);
    const visibleDirect = direct.filter((el) => !this.isDecorativeElement(el));

    if (
      astChildren.length === 1 &&
      (astChildren[0].isComponent || this.isPascalCase(astChildren[0].tagName)) &&
      visibleDirect.length === 1
    ) {
      const slotChildren = this
        .getContentElements(visibleDirect[0])
        .filter((el) => !this.isDecorativeElement(el));
      if (slotChildren.length > 0) return slotChildren;
    }

    if (visibleDirect.length === astChildren.length) {
      return visibleDirect;
    }

    return [];
  }

  /** Find the best DOM match for a single AST child anywhere in `root`'s
   *  subtree. For components, anchor on their first non-component
   *  descendant since components don't have a DOM tag of their own. */
  private matchAstChildAnywhere(astChild: ASTNodeLike, root: Element) {
    if (!this.rendersInBody(astChild)) return;
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
      if (!this.rendersInBody(node)) continue;
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
      if (!this.rendersInBody(node)) continue;
      const el = this.nodeIdToElement.get(node.nodeId);
      if (el) return el;
      const deeper = this.findFirstMappedDescendantEl(node.children);
      if (deeper) return deeper;
    }
    return null;
  }

  /** Score a tag+class+attribute+text overlap. 0 means tag mismatch (reject). */
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
    // Text tiebreaker: when the AST node is a text leaf, an exact (normalized)
    // copy match is the most reliable discriminator between siblings that share
    // tag + classes (e.g. several <p class="text-muted"> with different copy).
    // Only awarded on exact equality, so it can only break ties, never reject
    // an otherwise-good structural match. Weighted at +3 — stronger than one
    // shared class — because for editable content, copy identity beats position.
    const astText = normalizeText(astNode.textContent);
    if (astText && normalizeText(domEl.textContent) === astText) {
      score += 3;
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
      if (!this.rendersInBody(node)) continue;
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
      if (!this.rendersInBody(node)) continue;
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

  private rendersInBody(node: ASTNodeLike): boolean {
    return node.renderTarget !== "head";
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

  private isDecorativeElement(element: Element): boolean {
    return element.getAttribute("aria-hidden") === "true";
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

  isComponentNode(nodeId: string): boolean {
    const node = this.findNode(this.ast, nodeId);
    return !!node && (node.isComponent || this.isPascalCase(node.tagName));
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

  private findNode(nodes: ASTNodeLike[], nodeId: string): ASTNodeLike | null {
    for (const node of nodes) {
      if (node.nodeId === nodeId) return node;
      const found = this.findNode(node.children, nodeId);
      if (found) return found;
    }
    return null;
  }
}
