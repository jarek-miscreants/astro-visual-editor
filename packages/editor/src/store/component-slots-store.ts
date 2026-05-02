import { create } from "zustand";
import { api } from "../lib/api-client";

export interface ComponentSlotDef {
  name: string | null;
}

interface ComponentSlotsState {
  /** Cache keyed by component path. `null` is the loading marker, `undefined`
   *  means we haven't asked yet. An entry with empty array means the component
   *  has no slots — surface that as "no children allowed". */
  cache: Record<string, ComponentSlotDef[] | null>;
  /** Fetch and cache slot definitions for a component path. Returns the
   *  cached entry (or [] if the fetch fails) — components without a Props
   *  schema or with parse errors degrade to "no slots known". */
  ensure: (componentPath: string) => Promise<ComponentSlotDef[]>;
  /** Synchronous read of the current cache value, useful in render. Returns
   *  undefined when the entry hasn't been requested yet. */
  get: (componentPath: string) => ComponentSlotDef[] | null | undefined;
  /** Drop the cached entry so the next ensure() refetches. Wired to the
   *  file-watcher when a component's source changes. */
  invalidate: (componentPath: string) => void;
}

export const useComponentSlotsStore = create<ComponentSlotsState>((set, get) => ({
  cache: {},

  async ensure(componentPath) {
    const existing = get().cache[componentPath];
    if (Array.isArray(existing)) return existing;
    if (existing === null) {
      // In flight — wait for it. Poll briefly; ensure() is rarely contended.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const v = get().cache[componentPath];
        if (Array.isArray(v)) return v;
      }
      return [];
    }
    set((s) => ({ cache: { ...s.cache, [componentPath]: null } }));
    try {
      const { slots } = await api.getComponentSlots(componentPath);
      set((s) => ({ cache: { ...s.cache, [componentPath]: slots } }));
      return slots;
    } catch {
      set((s) => ({ cache: { ...s.cache, [componentPath]: [] } }));
      return [];
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
