import { useEffect } from "react";
import { EditorLayout } from "./components/layout/EditorLayout";
import { useEditorStore } from "./store/editor-store";
import { useHistoryStore } from "./store/history-store";
import { useThemeStore } from "./store/theme-store";

export default function App() {
  const initProject = useEditorStore((s) => s.initProject);
  const applyMutation = useEditorStore((s) => s.applyMutation);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const loadTokens = useThemeStore((s) => s.loadTokens);

  useEffect(() => {
    initProject();
    loadTheme();
    loadTokens();
  }, [initProject, loadTheme, loadTokens]);

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

  return <EditorLayout />;
}
