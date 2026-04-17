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
    } catch {
      set({ loaded: true });
    }
  },
  setUserMode(mode) {
    set({ userMode: mode });
  },
}));
