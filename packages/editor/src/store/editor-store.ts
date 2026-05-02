import { create } from "zustand";
import type {
  ASTNode,
  FileInfo,
  ElementInfo,
  Mutation,
  DevServerStatus,
  DevServerStartError,
} from "@tve/shared";
import { api } from "../lib/api-client";
import {
  provideAstToIframe,
  updateClassesInIframe,
  updateTextInIframe,
  selectNodeInIframe,
} from "../lib/iframe-bridge";
import { connectWebSocket, onWsMessage } from "../lib/ws-client";
import { useHistoryStore, computeInverse } from "./history-store";
import { toast } from "./toast-store";
import { useGitStore } from "./git-store";
import { useComponentSlotsStore } from "./component-slots-store";

function describeMutation(mutation: Mutation): string {
  switch (mutation.type) {
    case "update-classes":
      return "Classes updated";
    case "update-attribute":
      return `${mutation.attr} updated`;
    case "update-text":
      return "Text updated";
    case "add-element":
      return "Element added";
    case "remove-element":
      return "Element removed";
    case "move-element":
      return "Element moved";
    case "wrap-element":
      return "Element wrapped";
    default:
      return "Saved";
  }
}

interface EditorState {
  // Project
  projectPath: string | null;
  projectName: string | null;

  // Files
  files: FileInfo[];
  currentFile: string | null;

  // AST
  ast: ASTNode[] | null;
  nodeMap: Map<string, ASTNode>;

  // Selection
  selectedNodeId: string | null;
  selectedElementInfo: ElementInfo | null;
  hoveredNodeId: string | null;

  // Editor state
  mode: "edit" | "preview";
  devicePreset: "desktop" | "tablet" | "mobile";
  devServerStatus: DevServerStatus;
  devServerUrl: string | null;
  devServerError: DevServerStartError | null;
  iframeReady: boolean;

  // Actions
  initProject: () => Promise<void>;
  resetProject: () => void;
  loadFiles: () => Promise<void>;
  setCurrentFile: (path: string) => Promise<void>;
  selectNode: (nodeId: string | null, info?: ElementInfo | null) => void;
  hoverNode: (nodeId: string | null) => void;
  setMode: (mode: "edit" | "preview") => void;
  setDevicePreset: (preset: "desktop" | "tablet" | "mobile") => void;
  setIframeReady: (ready: boolean) => void;
  applyMutation: (mutation: Mutation, skipHistory?: boolean) => Promise<void>;
  startDevServer: () => Promise<void>;
  updateAst: (ast: ASTNode[]) => void;
}

function buildNodeMap(nodes: ASTNode[]): Map<string, ASTNode> {
  const map = new Map<string, ASTNode>();
  function walk(node: ASTNode) {
    map.set(node.nodeId, node);
    for (const child of node.children) walk(child);
  }
  for (const node of nodes) walk(node);
  return map;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectPath: null,
  projectName: null,
  files: [],
  currentFile: null,
  ast: null,
  nodeMap: new Map(),
  selectedNodeId: null,
  selectedElementInfo: null,
  hoveredNodeId: null,
  mode: "edit",
  devicePreset: "desktop",
  devServerStatus: "stopped",
  devServerUrl: null,
  devServerError: null,
  iframeReady: false,

  resetProject() {
    // Clear all project-scoped state so the editor can load a fresh project.
    // Does not touch user preferences (mode, devicePreset) or WebSocket listeners.
    set({
      projectPath: null,
      projectName: null,
      files: [],
      currentFile: null,
      ast: null,
      nodeMap: new Map(),
      selectedNodeId: null,
      selectedElementInfo: null,
      hoveredNodeId: null,
      devServerStatus: "stopped",
      devServerUrl: null,
      devServerError: null,
      iframeReady: false,
    });
    useGitStore.getState().reset();
  },

  async initProject() {
    try {
      // Connect WebSocket
      connectWebSocket();

      // Listen for server events
      onWsMessage((msg) => {
        if (msg.type === "dev-server:ready") {
          set({ devServerStatus: "running", devServerUrl: msg.url, devServerError: null });
        }
        if (msg.type === "dev-server:error") {
          set({
            devServerStatus: "error",
            devServerError: msg.error ?? { kind: "unknown", message: msg.message, raw: msg.message },
          });
        }
        if (msg.type === "file:changed") {
          // Any source-file change can affect the working-tree status
          useGitStore.getState().refreshDebounced();
          // If a component's source changed, drop its slot cache so the
          // tree picks up renamed/added/removed slots on the next render.
          if (msg.path.startsWith("src/components/")) {
            useComponentSlotsStore.getState().invalidate(msg.path);
          }
          const state = get();
          if (state.currentFile === msg.path) {
            const newMap = buildNodeMap(msg.ast);
            const patch: Partial<EditorState> = {
              ast: msg.ast,
              nodeMap: newMap,
            };
            // The file was edited outside of a user mutation (manual save,
            // formatter run, another tool). Positional nodeIds may now point
            // at different elements than what the user had selected. If the
            // selection would end up on something with a different tag, drop
            // it so the next action can't operate on the wrong target.
            if (state.selectedNodeId) {
              const stillThere = newMap.get(state.selectedNodeId);
              const prevTag = state.selectedElementInfo?.tagName;
              if (!stillThere || (prevTag && stillThere.tagName !== prevTag)) {
                patch.selectedNodeId = null;
                patch.selectedElementInfo = null;
              }
            }
            set(patch);
            provideAstToIframe(msg.ast);
          }
        }
      });

      // Get project info
      const info = await api.getProjectInfo();
      set({ projectPath: info.path, projectName: info.name });

      // Load files
      await get().loadFiles();

      // Initial git status — non-blocking, widget hides itself if no-git
      if (info.path) {
        useGitStore.getState().refresh();
      }

      // Check dev server status
      const status = await api.getDevServerStatus();
      if (status.url) {
        set({ devServerStatus: "running" as DevServerStatus, devServerUrl: status.url });
      }
    } catch (err) {
      console.error("Failed to init project:", err);
    }
  },

  async loadFiles() {
    try {
      const { files } = await api.getFiles();
      set({ files });
    } catch (err) {
      console.error("Failed to load files:", err);
    }
  },

  async setCurrentFile(path: string) {
    set({ currentFile: path, selectedNodeId: null, selectedElementInfo: null, iframeReady: false });
    try {
      const { ast } = await api.getAst(path);
      set({ ast, nodeMap: buildNodeMap(ast) });
    } catch (err) {
      console.error("Failed to load AST:", err);
    }
  },

  selectNode(nodeId, info = null) {
    set({ selectedNodeId: nodeId, selectedElementInfo: info ?? null });
    selectNodeInIframe(nodeId);
  },

  hoverNode(nodeId) {
    set({ hoveredNodeId: nodeId });
  },

  setMode(mode) {
    set({ mode });
  },

  setDevicePreset(preset) {
    set({ devicePreset: preset });
  },

  setIframeReady(ready) {
    const state = get();
    set({ iframeReady: ready });
    // Send AST to iframe when it becomes ready
    if (ready && state.ast) {
      provideAstToIframe(state.ast);
    }
  },

  async applyMutation(mutation, skipHistory = false) {
    const state = get();
    if (!state.currentFile) return;

    // Compute inverse for undo before applying
    if (!skipHistory) {
      let prevClasses: string | undefined;
      let prevText: string | undefined;
      if (mutation.type === "update-classes") {
        const node = state.nodeMap.get(mutation.nodeId);
        prevClasses = node?.classes || state.selectedElementInfo?.classes || "";
      }
      if (mutation.type === "update-text") {
        const node = state.nodeMap.get(mutation.nodeId);
        prevText = node?.textContent || state.selectedElementInfo?.textContent || "";
      }
      const inverse = computeInverse(mutation, {
        previousClasses: prevClasses,
        previousText: prevText,
        ast: state.ast || undefined,
        nodeMap: state.nodeMap,
      });
      useHistoryStore.getState().push({ mutation, inverse });
    }

    // Optimistic update in iframe
    if (mutation.type === "update-classes") {
      updateClassesInIframe(mutation.nodeId, mutation.classes);
    }
    if (mutation.type === "update-text") {
      updateTextInIframe(mutation.nodeId, mutation.text);
    }

    // Apply to source file
    try {
      const result = await api.applyMutation(state.currentFile, mutation);
      if (result.success && result.ast) {
        const newNodeMap = buildNodeMap(result.ast);
        const nextState: Partial<EditorState> = {
          ast: result.ast,
          nodeMap: newNodeMap,
        };

        // Positional nodeIds (`tve-{hash}-{index}`) shift on structural edits.
        // Keep selection pointed at something sensible.
        if (
          mutation.type === "remove-element" &&
          state.selectedNodeId === mutation.nodeId
        ) {
          nextState.selectedNodeId = null;
          nextState.selectedElementInfo = null;
        } else if (mutation.type === "move-element") {
          // Re-locate the moved element. newParentId is stable (we only move
          // children, not their parent). After the server applies the move,
          // the moved element sits at mutation.newPosition in the new AST.
          const newParent = newNodeMap.get(mutation.newParentId);
          const reselected = newParent?.children[mutation.newPosition];
          if (reselected) {
            nextState.selectedNodeId = reselected.nodeId;
            nextState.selectedElementInfo = {
              nodeId: reselected.nodeId,
              tagName: reselected.tagName,
              classes: reselected.classes,
              textContent: reselected.textContent,
              attributes: reselected.attributes,
              rect: state.selectedElementInfo?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
              computedStyles: state.selectedElementInfo?.computedStyles ?? {
                display: "", position: "", padding: "", margin: "",
                fontSize: "", color: "", backgroundColor: "",
              },
            };
          } else {
            nextState.selectedNodeId = null;
            nextState.selectedElementInfo = null;
          }
        } else if (
          mutation.type === "duplicate-element" ||
          mutation.type === "wrap-element" ||
          mutation.type === "add-element"
        ) {
          // These all shift indices downstream. Dropping selection is safer
          // than risking a subsequent action on the wrong element.
          nextState.selectedNodeId = null;
          nextState.selectedElementInfo = null;
        }

        set(nextState);
        toast.success(describeMutation(mutation), state.currentFile);
        // Working tree is now dirty — refresh the git widget. Debounced so
        // that rapid-fire mutations don't hammer the API.
        useGitStore.getState().refreshDebounced();
      } else if (!result.success) {
        console.error("Mutation failed:", result.error);
        toast.error("Couldn't save", result.error || "The mutation was rejected.");
      }
    } catch (err: any) {
      console.error("Failed to apply mutation:", err);
      toast.error("Couldn't save", err?.message ?? "Unknown error");
    }
  },

  async startDevServer() {
    set({ devServerStatus: "starting", devServerError: null });
    try {
      const result = await api.startDevServer();
      if (result.success && result.url) {
        set({ devServerStatus: "running", devServerUrl: result.url, devServerError: null });
        return;
      }
      // success: false — server returned a structured error
      const err = result.error;
      const structured: DevServerStartError =
        typeof err === "string" || !err
          ? { kind: "unknown", message: typeof err === "string" ? err : "Failed to start dev server", raw: typeof err === "string" ? err : "" }
          : err;
      set({ devServerStatus: "error", devServerError: structured });
    } catch (err: any) {
      console.error("Failed to start dev server:", err);
      set({
        devServerStatus: "error",
        devServerError: { kind: "unknown", message: err?.message ?? "Failed to start dev server", raw: err?.stack ?? String(err) },
      });
    }
  },

  updateAst(ast) {
    set({ ast, nodeMap: buildNodeMap(ast) });
    provideAstToIframe(ast);
  },
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
