import { create } from "zustand";

interface TreeUIStore {
  query: string;
  setQuery: (q: string) => void;
  /** Marketer zoom: hide pure-structural wrappers so only components + text remain. */
  marketerZoom: boolean;
  toggleMarketerZoom: () => void;
  /** Currently open slot AddElementPanel, identified by `${parentId}:${slotName ?? ""}`.
   *  Singleton — opening another slot's panel closes the previous one. */
  openSlotId: string | null;
  openSlot: (id: string | null) => void;
}

const ZOOM_KEY = "tve:tree-ui:marketer-zoom";

export const useTreeUIStore = create<TreeUIStore>((set) => ({
  query: "",
  setQuery: (q) => set({ query: q }),
  marketerZoom:
    typeof window !== "undefined"
      ? window.localStorage.getItem(ZOOM_KEY) !== "0"
      : true,
  toggleMarketerZoom: () =>
    set((state) => {
      const next = !state.marketerZoom;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ZOOM_KEY, next ? "1" : "0");
      }
      return { marketerZoom: next };
    }),
  openSlotId: null,
  openSlot: (id) => set({ openSlotId: id }),
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
