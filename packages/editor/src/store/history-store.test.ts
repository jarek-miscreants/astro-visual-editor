import { describe, it, expect, beforeEach } from "vitest";
import type { ASTNode, Mutation } from "@tve/shared";
import { useHistoryStore, computeInverse } from "./history-store";

function makeNode(nodeId: string, children: ASTNode[] = []): ASTNode {
  return {
    nodeId,
    tagName: "div",
    isComponent: false,
    classes: "",
    textContent: null,
    attributes: {},
    children,
    position: { start: { offset: 0, line: 1, column: 0 }, end: { offset: 0, line: 1, column: 0 } },
    isDynamic: false,
  };
}

describe("computeInverse", () => {
  describe("update-classes", () => {
    it("inverse swaps in previousClasses", () => {
      const inv = computeInverse(
        { type: "update-classes", nodeId: "n1", classes: "p-8 mx-auto" },
        { previousClasses: "p-4" }
      );
      expect(inv).toEqual({ type: "update-classes", nodeId: "n1", classes: "p-4" });
    });

    it("falls back to empty string when no previousClasses given", () => {
      const inv = computeInverse({
        type: "update-classes",
        nodeId: "n1",
        classes: "p-8",
      });
      expect(inv).toEqual({ type: "update-classes", nodeId: "n1", classes: "" });
    });
  });

  describe("update-text", () => {
    it("inverse swaps in previousText", () => {
      const inv = computeInverse(
        { type: "update-text", nodeId: "n1", text: "new" },
        { previousText: "old" }
      );
      expect(inv).toEqual({ type: "update-text", nodeId: "n1", text: "old" });
    });
  });

  describe("update-attribute", () => {
    it("returns null — no honest inverse without prior value", () => {
      const m: Mutation = {
        type: "update-attribute",
        nodeId: "n1",
        attr: "href",
        value: "/about",
      };
      expect(computeInverse(m)).toBeNull();
    });
  });

  describe("move-element", () => {
    it("computes inverse from current AST position", () => {
      // Tree: root[a, b, c]; we move 'b' to a different parent. Inverse should
      // restore 'b' to root at index 1.
      const ast: ASTNode[] = [
        makeNode("root", [makeNode("a"), makeNode("b"), makeNode("c")]),
      ];
      const inv = computeInverse(
        { type: "move-element", nodeId: "b", newParentId: "elsewhere", newPosition: 0 },
        { ast }
      );
      expect(inv).toEqual({
        type: "move-element",
        nodeId: "b",
        newParentId: "root",
        newPosition: 1,
      });
    });

    it("returns null when AST not provided (no way to know original position)", () => {
      const inv = computeInverse({
        type: "move-element",
        nodeId: "b",
        newParentId: "x",
        newPosition: 5,
      });
      expect(inv).toBeNull();
    });

    it("walks deeply nested children", () => {
      const ast: ASTNode[] = [
        makeNode("root", [
          makeNode("a"),
          makeNode("b", [makeNode("c"), makeNode("d", [makeNode("target")])]),
        ]),
      ];
      const inv = computeInverse(
        { type: "move-element", nodeId: "target", newParentId: "x", newPosition: 0 },
        { ast }
      );
      expect(inv).toEqual({
        type: "move-element",
        nodeId: "target",
        newParentId: "d",
        newPosition: 0,
      });
    });
  });

  describe("structural mutations without honest inverses", () => {
    // These return null so the editor-store skips recording them, keeping
    // undo/redo honest. Restoring undo support for any of these requires
    // capturing pre-mutation snapshots first.
    it("add-element returns null", () => {
      const inv = computeInverse({
        type: "add-element",
        parentNodeId: "p",
        position: 0,
        html: "<div/>",
      });
      expect(inv).toBeNull();
    });

    it("remove-element returns null", () => {
      expect(computeInverse({ type: "remove-element", nodeId: "n1" })).toBeNull();
    });

    it("duplicate-element returns null", () => {
      expect(computeInverse({ type: "duplicate-element", nodeId: "n1" })).toBeNull();
    });

    it("wrap-element returns null", () => {
      const m: Mutation = { type: "wrap-element", nodeId: "n1", wrapperTag: "div" };
      expect(computeInverse(m)).toBeNull();
    });
  });
});

describe("useHistoryStore", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  function makeEntry(label: string) {
    return {
      mutation: { type: "update-classes" as const, nodeId: label, classes: "new" },
      inverse: { type: "update-classes" as const, nodeId: label, classes: "old" },
    };
  }

  it("starts empty", () => {
    const s = useHistoryStore.getState();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
  });

  it("push enables undo, clears future", () => {
    useHistoryStore.getState().push(makeEntry("a"));
    const s = useHistoryStore.getState();
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
    expect(s.past).toHaveLength(1);
  });

  it("undo + redo round-trips", () => {
    useHistoryStore.getState().push(makeEntry("a"));
    useHistoryStore.getState().push(makeEntry("b"));

    const undone = useHistoryStore.getState().undo();
    expect(undone?.mutation.type).toBe("update-classes");
    if (undone?.mutation.type === "update-classes") {
      expect(undone.mutation.nodeId).toBe("b");
    }

    const stateAfterUndo = useHistoryStore.getState();
    expect(stateAfterUndo.canUndo).toBe(true);
    expect(stateAfterUndo.canRedo).toBe(true);

    const redone = useHistoryStore.getState().redo();
    expect(redone?.mutation.type).toBe("update-classes");
    if (redone?.mutation.type === "update-classes") {
      expect(redone.mutation.nodeId).toBe("b");
    }

    const after = useHistoryStore.getState();
    expect(after.canRedo).toBe(false);
    expect(after.past).toHaveLength(2);
  });

  it("undo on empty stack returns null", () => {
    expect(useHistoryStore.getState().undo()).toBeNull();
  });

  it("a new push after undo clears the redo future", () => {
    useHistoryStore.getState().push(makeEntry("a"));
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canRedo).toBe(true);

    useHistoryStore.getState().push(makeEntry("c"));
    expect(useHistoryStore.getState().canRedo).toBe(false);
    expect(useHistoryStore.getState().future).toEqual([]);
  });

  it("clear resets everything", () => {
    useHistoryStore.getState().push(makeEntry("a"));
    useHistoryStore.getState().clear();
    const s = useHistoryStore.getState();
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.canUndo).toBe(false);
  });
});
