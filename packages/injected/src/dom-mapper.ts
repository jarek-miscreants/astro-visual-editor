interface ASTNodeLike {
  nodeId: string;
  tagName: string;
  isComponent: boolean;
  classes: string;
  children: ASTNodeLike[];
}

/**
 * Maps live DOM elements to AST nodeIds by walking both trees in parallel.
 * Components (PascalCase tags like Layout, Card) don't produce DOM elements,
 * so we skip them and match their children directly.
 */
export class DomMapper {
  private ast: ASTNodeLike[] = [];
  private elementToNodeId = new Map<Element, string>();
  private nodeIdToElement = new Map<string, Element>();

  setAst(ast: ASTNodeLike[]) {
    this.ast = ast;
  }

  remap() {
    this.elementToNodeId.clear();
    this.nodeIdToElement.clear();

    const body = document.body;
    if (!body) return;

    const bodyElements = this.getContentElements(body);

    // Flatten AST roots: skip components, use their children
    const flatRoots = this.flattenComponents(this.ast);
    this.matchChildren(flatRoots, bodyElements);

    // Map component nodes to their first rendered DOM element
    // So clicking inside a component selects the component instance
    this.mapComponentsToDOM(this.ast, bodyElements);

    console.log(
      `[TVE DOM Mapper] Mapped ${this.elementToNodeId.size} elements`
    );
  }

  /**
   * For each component node, find the first DOM element rendered by its
   * flattened children and map it to the component's nodeId.
   * This allows getClosestMappedElement to find the component when
   * clicking inside component-rendered content.
   */
  private mapComponentsToDOM(nodes: ASTNodeLike[], domElements: Element[]) {
    for (const node of nodes) {
      if ((node.isComponent || this.isPascalCase(node.tagName)) && node.children.length > 0) {
        // Find the first child's mapped DOM element
        const firstChild = this.flattenComponents(node.children)[0];
        if (firstChild) {
          const domEl = this.nodeIdToElement.get(firstChild.nodeId);
          if (domEl) {
            // Map the component nodeId to this DOM element (if not already mapped to something else)
            if (!this.nodeIdToElement.has(node.nodeId)) {
              this.nodeIdToElement.set(node.nodeId, domEl);
              // Don't overwrite elementToNodeId — the DOM element keeps its own nodeId
              // Instead, we'll handle this in getClosestMappedElement
            }
          }
        }
      }
      // Recurse into children (components can contain other components)
      if (node.children.length > 0) {
        this.mapComponentsToDOM(node.children, domElements);
      }
    }
  }

  /**
   * Flatten component nodes: components don't render as DOM elements,
   * so replace them with their children for matching purposes.
   */
  private flattenComponents(nodes: ASTNodeLike[]): ASTNodeLike[] {
    const result: ASTNodeLike[] = [];
    for (const node of nodes) {
      if (node.isComponent || this.isPascalCase(node.tagName)) {
        // Component — skip it, use its children instead
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

  private matchChildren(astNodes: ASTNodeLike[], domElements: Element[]) {
    let domIndex = 0;

    for (const astNode of astNodes) {
      if (domIndex >= domElements.length) break;

      // Flatten this node if it's a component
      if (astNode.isComponent || this.isPascalCase(astNode.tagName)) {
        const flatChildren = this.flattenComponents(astNode.children);
        // Match component's children against remaining DOM elements
        for (const child of flatChildren) {
          if (domIndex >= domElements.length) break;
          this.matchSingle(child, domElements, domIndex);
          // Advance domIndex for each matched child
          if (domIndex < domElements.length &&
              domElements[domIndex].tagName.toLowerCase() === child.tagName.toLowerCase()) {
            domIndex++;
          }
        }
        continue;
      }

      const domEl = domElements[domIndex];

      if (domEl.tagName.toLowerCase() === astNode.tagName.toLowerCase()) {
        this.elementToNodeId.set(domEl, astNode.nodeId);
        this.nodeIdToElement.set(astNode.nodeId, domEl);

        // Recursively match children (flattening any nested components)
        const childElements = this.getContentElements(domEl);
        const flatChildren = this.flattenComponents(astNode.children);
        if (flatChildren.length > 0 && childElements.length > 0) {
          this.matchChildren(flatChildren, childElements);
        }

        domIndex++;
      } else {
        // Tags don't match — skip this DOM element and retry
        domIndex++;
        if (domIndex < domElements.length) {
          const nextDomEl = domElements[domIndex];
          if (nextDomEl.tagName.toLowerCase() === astNode.tagName.toLowerCase()) {
            this.elementToNodeId.set(nextDomEl, astNode.nodeId);
            this.nodeIdToElement.set(astNode.nodeId, nextDomEl);

            const childElements = this.getContentElements(nextDomEl);
            const flatChildren = this.flattenComponents(astNode.children);
            if (flatChildren.length > 0 && childElements.length > 0) {
              this.matchChildren(flatChildren, childElements);
            }
            domIndex++;
          }
        }
      }
    }
  }

  private matchSingle(astNode: ASTNodeLike, domElements: Element[], index: number) {
    if (index >= domElements.length) return;
    const domEl = domElements[index];
    if (domEl.tagName.toLowerCase() === astNode.tagName.toLowerCase()) {
      this.elementToNodeId.set(domEl, astNode.nodeId);
      this.nodeIdToElement.set(astNode.nodeId, domEl);

      const childElements = this.getContentElements(domEl);
      const flatChildren = this.flattenComponents(astNode.children);
      if (flatChildren.length > 0 && childElements.length > 0) {
        this.matchChildren(flatChildren, childElements);
      }
    }
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

  getNodeCount(): number {
    return this.elementToNodeId.size;
  }

  /** Find the closest mapped ancestor */
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
