import { create } from "zustand";
import type { ContentFileInfo, ContentFile } from "@tve/shared";
import { api } from "../lib/api-client";

interface ContentState {
  files: ContentFileInfo[];
  currentPath: string | null;
  current: ContentFile | null;
  dirty: boolean;
  saving: boolean;
  deleting: boolean;
  lastError: string | null;
  revision: number;

  loadFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  createFile: (input: {
    collection: string;
    slug: string;
    format: "md" | "mdx";
    root?: "src/content" | "src/pages" | "content";
    frontmatter?: Record<string, any>;
    body?: string;
  }) => Promise<string>;
  deleteFile: (path: string) => Promise<void>;
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
  deleting: false,
  lastError: null,
  revision: 0,

  async loadFiles() {
    try {
      const { files } = await api.getContentFiles();
      set({ files });
    } catch (err: any) {
      set({ lastError: err.message });
    }
  },

  async openFile(path) {
    set({ currentPath: path, current: null, dirty: false, lastError: null, revision: 0 });
    try {
      const file = await api.readContentFile(path);
      set({ current: file, revision: 0 });
    } catch (err: any) {
      set({ lastError: err.message });
    }
  },

  closeFile() {
    set({ currentPath: null, current: null, dirty: false, lastError: null, revision: 0 });
  },

  async createFile(input) {
    const { path } = await api.createContentFile(input);
    await get().loadFiles();
    await get().openFile(path);
    return path;
  },

  async deleteFile(path) {
    if (!path) return;
    set({ deleting: true, lastError: null });
    try {
      await api.deleteContentFile(path);
      const { files } = await api.getContentFiles();
      const isCurrent = get().currentPath === path;
      set({
        files,
        deleting: false,
        currentPath: isCurrent ? null : get().currentPath,
        current: isCurrent ? null : get().current,
        dirty: isCurrent ? false : get().dirty,
        revision: isCurrent ? 0 : get().revision,
      });
    } catch (err: any) {
      set({ deleting: false, lastError: err.message });
      throw err;
    }
  },

  updateBody(body) {
    const { current, revision } = get();
    if (!current) return;
    set({ current: { ...current, body }, dirty: true, revision: revision + 1 });
  },

  updateFrontmatterField(key, value) {
    const { current, revision } = get();
    if (!current) return;
    set({
      current: { ...current, frontmatter: { ...current.frontmatter, [key]: value } },
      dirty: true,
      revision: revision + 1,
    });
  },

  renameFrontmatterField(oldKey, newKey) {
    const { current, revision } = get();
    if (!current || oldKey === newKey) return;
    if (!(oldKey in current.frontmatter)) return;
    if (newKey in current.frontmatter) return; // refuse to clobber

    const next: Record<string, any> = {};
    for (const [k, v] of Object.entries(current.frontmatter)) {
      next[k === oldKey ? newKey : k] = v;
    }
    set({ current: { ...current, frontmatter: next }, dirty: true, revision: revision + 1 });
  },

  removeFrontmatterField(key) {
    const { current, revision } = get();
    if (!current) return;
    const { [key]: _removed, ...rest } = current.frontmatter;
    set({ current: { ...current, frontmatter: rest }, dirty: true, revision: revision + 1 });
  },

  async save() {
    const { current, currentPath, revision } = get();
    if (!current || !currentPath) return;
    set({ saving: true, lastError: null });
    try {
      await api.writeContentFile(currentPath, current.frontmatter, current.body);
      const latest = get();
      set({
        saving: false,
        dirty: latest.currentPath === currentPath && latest.revision === revision ? false : latest.dirty,
      });
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
