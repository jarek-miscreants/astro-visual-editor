import { useEffect } from "react";
import { EditorLayout } from "./components/layout/EditorLayout";
import { useEditorStore } from "./store/editor-store";
import { useHistoryStore } from "./store/history-store";
import { useThemeStore } from "./store/theme-store";
import { useModeStore } from "./store/mode-store";
import { useContentStore } from "./store/content-store";
import { useAuthStore, consumeSignedInQuery } from "./store/auth-store";
import { onIframeMessage } from "./lib/iframe-bridge";

export default function App() {
  const initProject = useEditorStore((s) => s.initProject);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const loadTokens = useThemeStore((s) => s.loadTokens);
  const loadMode = useModeStore((s) => s.loadMode);
  const loadContentFiles = useContentStore((s) => s.loadFiles);
  const loadAuth = useAuthStore((s) => s.loadAuth);

  useEffect(() => {
    initProject();
    loadTheme();
    loadTokens();
    loadMode();
    loadContentFiles();
    // If we're returning from the OAuth callback, strip the query
    // params before loadAuth so reloads don't loop.
    consumeSignedInQuery();
    loadAuth();
  }, [initProject, loadTheme, loadTokens, loadMode, loadContentFiles, loadAuth]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Undo: Ctrl+Z
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const entry = useHistoryStore.getState().undo();
        if (entry) {
          applyMutation(entry.inverse, true);
        }
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((e.ctrlKey && e.shiftKey && e.key === "Z") || (e.ctrlKey && e.key === "y")) {
        e.preventDefault();
        const entry = useHistoryStore.getState().redo();
        if (entry) {
          applyMutation(entry.mutation, true);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [applyMutation]);

  // Re-dispatch shortcuts forwarded from the preview iframe. Keydowns inside
  // the iframe never reach our window-level handlers, so we replay them here
  // as a synthetic event on window — every global shortcut listener then fires.
  useEffect(() => {
    return onIframeMessage((message) => {
      if (message.type !== "tve:keydown") return;
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: message.key,
          ctrlKey: message.ctrlKey,
          shiftKey: message.shiftKey,
          altKey: message.altKey,
          metaKey: message.metaKey,
          bubbles: true,
          cancelable: true,
        })
      );
    });
  }, []);

  return <EditorLayout />;
}
