interface ASTNodeLike {
  nodeId: string;
  tagName: string;
  isComponent: boolean;
  isDynamic?: boolean;
  classes: string;
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

    // Flatten AST roots (skip components)
    const flatRoots = this.flattenComponents(this.ast);
    this.matchChildren(flatRoots, bodyElements);

    // Map component nodes to their first rendered DOM element
    this.mapComponentsToDOM(this.ast);

    console.log(
      `[TVE DOM Mapper] Mapped ${this.elementToNodeId.size} elements (${this.nodeIdToInstances.size} dynamic templates)`
    );
  }

  /**
   * Match a list of AST nodes against a list of DOM elements.
   * Handles dynamic nodes by matching multiple consecutive DOM elements
   * against a single AST template node.
   */
  private matchChildren(astNodes: ASTNodeLike[], domElements: Element[]) {
    let domIndex = 0;

    for (const astNode of astNodes) {
      if (domIndex >= domElements.length) break;

      // Skip components — they don't render as DOM elements
      if (astNode.isComponent || this.isPascalCase(astNode.tagName)) {
        const flatChildren = this.flattenComponents(astNode.children);
        const consumed = this.matchChildren(flatChildren, domElements.slice(domIndex));
        domIndex += consumed;
        continue;
      }

      // Dynamic templates: match all consecutive DOM elements with the same tag
      if (astNode.isDynamic) {
        // Skip non-matching DOM elements first
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
      // (the DOM may have wrapper elements not in the AST, like Layout's <div>, <nav>)
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
      const flatChildren = this.flattenComponents(astNode.children);
      if (flatChildren.length > 0 && childElements.length > 0) {
        this.matchChildren(flatChildren, childElements);
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

      // Recursively match children
      const childElements = this.getContentElements(domEl);
      const flatChildren = this.flattenComponents(astNode.children);
      if (flatChildren.length > 0 && childElements.length > 0) {
        this.matchChildren(flatChildren, childElements);
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
