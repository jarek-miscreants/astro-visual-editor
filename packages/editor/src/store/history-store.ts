import { create } from "zustand";
import type { Mutation, MutationWithInverse, ASTNode } from "@tve/shared";

interface HistoryState {
  past: MutationWithInverse[];
  future: MutationWithInverse[];
  canUndo: boolean;
  canRedo: boolean;
  push: (entry: MutationWithInverse) => void;
  undo: () => MutationWithInverse | null;
  redo: () => MutationWithInverse | null;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  push(entry) {
    set((state) => ({
      past: [...state.past, entry],
      future: [],
      canUndo: true,
      canRedo: false,
    }));
  },

  undo() {
    const { past } = get();
    if (past.length === 0) return null;

    const entry = past[past.length - 1];
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
      canUndo: state.past.length > 1,
      canRedo: true,
    }));
    return entry;
  },

  redo() {
    const { future } = get();
    if (future.length === 0) return null;

    const entry = future[0];
    set((state) => ({
      past: [...state.past, entry],
      future: state.future.slice(1),
      canUndo: true,
      canRedo: state.future.length > 1,
    }));
    return entry;
  },

  clear() {
    set({ past: [], future: [], canUndo: false, canRedo: false });
  },
}));

/** Find parent node and index of a node in the AST */
function findParentInAst(
  nodes: ASTNode[],
  targetId: string
): { parentId: string; index: number } | null {
  for (const n of nodes) {
    for (let i = 0; i < n.children.length; i++) {
      if (n.children[i].nodeId === targetId) {
        return { parentId: n.nodeId, index: i };
      }
    }
    const found = findParentInAst(n.children, targetId);
    if (found) return found;
  }
  return null;
}

/**
 * Compute the inverse of a mutation for undo support.
 *
 * Returns `null` when no honest inverse can be derived from the available
 * context — the caller should skip recording the entry rather than push a
 * placeholder that would silently no-op (or worse, replay) on undo.
 *
 * Currently inverted: update-classes, update-text, move-element (with AST).
 * Structural mutations (add/remove/duplicate/wrap) and update-attribute would
 * need pre-mutation snapshots, which we don't capture yet.
 */
export function computeInverse(
  mutation: Mutation,
  opts?: {
    previousClasses?: string;
    previousText?: string;
    ast?: ASTNode[];
    nodeMap?: Map<string, ASTNode>;
  }
): Mutation | null {
  const { previousClasses, previousText, ast } = opts || {};

  switch (mutation.type) {
    case "update-classes":
      return {
        type: "update-classes",
        nodeId: mutation.nodeId,
        classes: previousClasses ?? "",
      };
    case "update-text":
      return {
        type: "update-text",
        nodeId: mutation.nodeId,
        text: previousText ?? "",
      };
    case "move-element": {
      if (ast) {
        const original = findParentInAst(ast, mutation.nodeId);
        if (original) {
          return {
            type: "move-element",
            nodeId: mutation.nodeId,
            newParentId: original.parentId,
            newPosition: original.index,
          };
        }
      }
      return null;
    }
    // No honest inverse yet — skip recording so undo doesn't lie.
    case "update-attribute":
    case "add-element":
    case "remove-element":
    case "duplicate-element":
    case "wrap-element":
      return null;
    default:
      return null;
  }
}
