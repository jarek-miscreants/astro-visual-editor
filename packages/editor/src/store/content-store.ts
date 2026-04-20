import { create } from "zustand";
import type { ContentFileInfo, ContentFile } from "@tve/shared";
import { api } from "../lib/api-client";

interface ContentState {
  files: ContentFileInfo[];
  currentPath: string | null;
  current: ContentFile | null;
  dirty: boolean;
  saving: boolean;
  lastError: string | null;

  loadFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  updateBody: (body: string) => void;
  updateFrontmatterField: (key: string, value: any) => void;
  renameFrontmatterField: (oldKey: string, newKey: string) => void;
  removeFrontmatterField: (key: string) => void;
  save: () => Promise<void>;
}

export const useContentStore = create<ContentState>((set, get) => ({
  files: [],
  currentPath: null,
  current: null,
  dirty: false,
  saving: false,
  lastError: null,

  async loadFiles() {
    try {
      const { files } = await api.getContentFiles();
      set({ files });
    } catch (err: any) {
      set({ lastError: err.message });
    }
  },

  async openFile(path) {
    set({ currentPath: path, current: null, dirty: false, lastError: null });
    try {
      const file = await api.readContentFile(path);
      set({ current: file });
    } catch (err: any) {
      set({ lastError: err.message });
    }
  },

  closeFile() {
    set({ currentPath: null, current: null, dirty: false, lastError: null });
  },

  updateBody(body) {
    const current = get().current;
    if (!current) return;
    set({ current: { ...current, body }, dirty: true });
  },

  updateFrontmatterField(key, value) {
    const current = get().current;
    if (!current) return;
    set({
      current: { ...current, frontmatter: { ...current.frontmatter, [key]: value } },
      dirty: true,
    });
  },

  renameFrontmatterField(oldKey, newKey) {
    const current = get().current;
    if (!current || oldKey === newKey) return;
    if (!(oldKey in current.frontmatter)) return;
    if (newKey in current.frontmatter) return; // refuse to clobber

    const next: Record<string, any> = {};
    for (const [k, v] of Object.entries(current.frontmatter)) {
      next[k === oldKey ? newKey : k] = v;
    }
    set({ current: { ...current, frontmatter: next }, dirty: true });
  },

  removeFrontmatterField(key) {
    const current = get().current;
    if (!current) return;
    const { [key]: _removed, ...rest } = current.frontmatter;
    set({ current: { ...current, frontmatter: rest }, dirty: true });
  },

  async save() {
    const { current, currentPath } = get();
    if (!current || !currentPath) return;
    set({ saving: true, lastError: null });
    try {
      await api.writeContentFile(currentPath, current.frontmatter, current.body);
      set({ saving: false, dirty: false });
    } catch (err: any) {
      set({ saving: false, lastError: err.message });
    }
  },
}));

// Force a full reload on HMR — without this, editing any store dependency
// leaves some consumers bound to the old store instance while others import
// a fresh one, which silently splits the app's state in two.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
