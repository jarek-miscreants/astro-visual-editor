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
 * Pass the current AST to enable proper inverse computation for structural mutations.
 */
export function computeInverse(
  mutation: Mutation,
  opts?: {
    previousClasses?: string;
    previousText?: string;
    ast?: ASTNode[];
    nodeMap?: Map<string, ASTNode>;
  }
): Mutation {
  const { previousClasses, previousText, ast, nodeMap } = opts || {};

  switch (mutation.type) {
    case "update-classes":
      return {
        type: "update-classes",
        nodeId: mutation.nodeId,
        classes: previousClasses || "",
      };
    case "update-text":
      return {
        type: "update-text",
        nodeId: mutation.nodeId,
        text: previousText || "",
      };
    case "update-attribute":
      return mutation;
    case "add-element":
      return {
        type: "remove-element",
        nodeId: "",
      };
    case "remove-element":
      return {
        type: "add-element",
        parentNodeId: "",
        position: 0,
        html: "",
      };
    case "move-element": {
      // Compute the original parent and position from the current AST
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
      return {
        type: "move-element",
        nodeId: mutation.nodeId,
        newParentId: "",
        newPosition: 0,
      };
    }
    default:
      return mutation;
  }
}
