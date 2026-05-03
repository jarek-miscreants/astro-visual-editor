import { create } from "zustand";
import type { ComponentPropSchema } from "@tve/shared";
import { api } from "../lib/api-client";

interface ComponentPropsState {
  /** Cache keyed by component path. `null` is the loading marker, `undefined`
   *  means we haven't asked yet. An entry with empty `fields` means the
   *  component has no Props interface (or it couldn't be parsed). */
  cache: Record<string, ComponentPropSchema | null>;
  /** Fetch and cache the Props schema for a component path. Returns the
   *  cached entry (or an empty schema on failure) so callers always get
   *  something renderable. */
  ensure: (componentPath: string) => Promise<ComponentPropSchema>;
  /** Synchronous read of the current cache value, useful in render. Returns
   *  undefined when the entry hasn't been requested yet. */
  get: (componentPath: string) => ComponentPropSchema | null | undefined;
  /** Drop the cached entry so the next ensure() refetches. Wired to the
   *  file-watcher so when a component's source changes, the panel re-reads
   *  its Props interface (renamed/added/removed props show up immediately). */
  invalidate: (componentPath: string) => void;
}

export const useComponentPropsStore = create<ComponentPropsState>((set, get) => ({
  cache: {},

  async ensure(componentPath) {
    const existing = get().cache[componentPath];
    if (existing && existing !== null && Array.isArray(existing.fields)) {
      return existing;
    }
    if (existing === null) {
      // In flight — wait for it. Poll briefly; ensure() is rarely contended.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const v = get().cache[componentPath];
        if (v && v !== null && Array.isArray(v.fields)) return v;
      }
      return { componentPath, fields: [] };
    }
    set((s) => ({ cache: { ...s.cache, [componentPath]: null } }));
    try {
      const schema = await api.getComponentProps(componentPath);
      set((s) => ({ cache: { ...s.cache, [componentPath]: schema } }));
      return schema;
    } catch {
      const empty: ComponentPropSchema = { componentPath, fields: [] };
      set((s) => ({ cache: { ...s.cache, [componentPath]: empty } }));
      return empty;
    }
  },

  get(componentPath) {
    return get().cache[componentPath];
  },

  invalidate(componentPath) {
    set((s) => {
      const next = { ...s.cache };
      delete next[componentPath];
      return { cache: next };
    });
  },
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
