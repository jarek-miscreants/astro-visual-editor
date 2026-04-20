import { create } from "zustand";

interface TreeUIStore {
  query: string;
  setQuery: (q: string) => void;
  /** Marketer zoom: hide pure-structural wrappers so only components + text remain. */
  marketerZoom: boolean;
  toggleMarketerZoom: () => void;
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
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
