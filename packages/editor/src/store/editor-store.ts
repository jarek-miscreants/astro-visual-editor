import { create } from "zustand";
import type {
  ASTNode,
  FileInfo,
  ElementInfo,
  Mutation,
  DevServerStatus,
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
  iframeReady: boolean;

  // Actions
  initProject: () => Promise<void>;
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
  iframeReady: false,

  async initProject() {
    try {
      // Connect WebSocket
      connectWebSocket();

      // Listen for server events
      onWsMessage((msg) => {
        if (msg.type === "dev-server:ready") {
          set({ devServerStatus: "running", devServerUrl: msg.url });
        }
        if (msg.type === "dev-server:error") {
          set({ devServerStatus: "error" });
        }
        if (msg.type === "file:changed") {
          const state = get();
          if (state.currentFile === msg.path) {
            set({ ast: msg.ast, nodeMap: buildNodeMap(msg.ast) });
            provideAstToIframe(msg.ast);
          }
        }
      });

      // Get project info
      const info = await api.getProjectInfo();
      set({ projectPath: info.path, projectName: info.name });

      // Load files
      await get().loadFiles();

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
        const nextState: Partial<EditorState> = {
          ast: result.ast,
          nodeMap: buildNodeMap(result.ast),
        };
        // After a structural mutation, the previous selectedNodeId is stale —
        // nodeIds are positional (`tve-{hash}-{index}`), so deletes/inserts
        // shift them. Clear selection so the next action doesn't operate on
        // a different element that happened to land on the old index.
        if (
          mutation.type === "remove-element" &&
          state.selectedNodeId === mutation.nodeId
        ) {
          nextState.selectedNodeId = null;
          nextState.selectedElementInfo = null;
        }
        set(nextState);
      } else if (!result.success) {
        console.error("Mutation failed:", result.error);
      }
    } catch (err) {
      console.error("Failed to apply mutation:", err);
    }
  },

  async startDevServer() {
    set({ devServerStatus: "starting" });
    try {
      const result = await api.startDevServer();
      if (result.success && result.url) {
        set({ devServerStatus: "running", devServerUrl: result.url });
      }
    } catch (err) {
      console.error("Failed to start dev server:", err);
      set({ devServerStatus: "error" });
    }
  },

  updateAst(ast) {
    set({ ast, nodeMap: buildNodeMap(ast) });
    provideAstToIframe(ast);
  },
}));
