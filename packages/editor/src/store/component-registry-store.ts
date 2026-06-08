import { create } from "zustand";
import type { ComponentRegistryEntry, ComponentRegistryItem } from "@tve/shared";
import { api } from "../lib/api-client";

interface ComponentRegistryState {
  components: ComponentRegistryItem[];
  loading: boolean;
  lastError: string | null;
  entryCache: Record<string, ComponentRegistryEntry | null>;
  load: () => Promise<ComponentRegistryItem[]>;
  ensureEntry: (componentPath: string) => Promise<ComponentRegistryEntry | null>;
  getEntry: (componentPath: string) => ComponentRegistryEntry | null | undefined;
  invalidate: (componentPath?: string) => void;
}

export const useComponentRegistryStore = create<ComponentRegistryState>((set, get) => ({
  components: [],
  loading: false,
  lastError: null,
  entryCache: {},

  async load() {
    set({ loading: true, lastError: null });
    try {
      const { components } = await api.getComponentRegistry();
      set({ components, loading: false });
      return components;
    } catch (err: any) {
      set({ loading: false, lastError: err?.message ?? "Failed to load component registry" });
      return [];
    }
  },

  async ensureEntry(componentPath) {
    const existing = get().entryCache[componentPath];
    if (existing) return existing;
    if (existing === null) {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const current = get().entryCache[componentPath];
        if (current) return current;
      }
      return null;
    }

    set((state) => ({ entryCache: { ...state.entryCache, [componentPath]: null } }));
    try {
      const entry = await api.getComponentRegistryEntry(componentPath);
      set((state) => ({ entryCache: { ...state.entryCache, [componentPath]: entry } }));
      return entry;
    } catch (err: any) {
      set((state) => {
        const next = { ...state.entryCache };
        delete next[componentPath];
        return {
          entryCache: next,
          lastError: err?.message ?? "Failed to load component registry entry",
        };
      });
      return null;
    }
  },

  getEntry(componentPath) {
    return get().entryCache[componentPath];
  },

  invalidate(componentPath) {
    if (!componentPath) {
      set({ components: [], entryCache: {} });
      return;
    }
    set((state) => {
      const next = { ...state.entryCache };
      delete next[componentPath];
      return {
        components: state.components.filter((component) => component.componentPath !== componentPath),
        entryCache: next,
      };
    });
  },
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
