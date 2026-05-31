import { create } from "zustand";
import { api } from "../lib/api-client";

export type UserMode = "dev" | "marketer";

interface ModeState {
  userMode: UserMode;
  defaultMode: UserMode;
  loaded: boolean;
  loadMode: () => Promise<void>;
  setUserMode: (mode: UserMode) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  userMode: "dev",
  defaultMode: "dev",
  loaded: false,
  async loadMode() {
    try {
      const { defaultMode } = await api.getTveConfig();
      set({ userMode: defaultMode, defaultMode, loaded: true });
    } catch (err) {
      // Surface the failure: previously we silently fell back to the
      // hardcoded "dev" default, which made misconfigured tve.config
      // files invisible in production.
      console.warn(
        "[tve] failed to load TVE config; using built-in defaults",
        err
      );
      set({ loaded: true });
    }
  },
  setUserMode(mode) {
    set({ userMode: mode });
  },
}));

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
