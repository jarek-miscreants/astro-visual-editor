import { create } from "zustand";
import { api } from "../lib/api-client";
import {
  getDefaultTheme,
  DEFAULT_COLORS,
  type TailwindTheme,
} from "../lib/tailwind-defaults";

export interface DesignTokens {
  colors: Record<string, string>;
  typography: {
    fontFamily: Record<string, string>;
    scale: Record<string, { size: string; weight: string; lineHeight: string }>;
  };
  spacing: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
}

interface ThemeState {
  /** Resolved Tailwind theme (defaults + project extensions) */
  theme: TailwindTheme;
  /** Project's theme.extend values */
  extend: Record<string, any>;
  /** Tailwind version (3=JS config, 4=CSS @theme) */
  version: 3 | 4;
  /** CSS @theme variables (v4 only) */
  cssTheme: Record<string, string>;
  /** Design tokens */
  tokens: DesignTokens | null;
  loading: boolean;

  loadTheme: () => Promise<void>;
  loadTokens: () => Promise<void>;
  updateTokens: (tokens: DesignTokens) => Promise<void>;
  updateThemeExtend: (extend: Record<string, any>) => Promise<void>;

  /** Get all color names (from theme) */
  getColorNames: () => string[];
  /** Get color shades for a color name */
  getColorShades: (name: string) => Record<string, string>;
  /** Get hex value for a Tailwind color reference like "blue-600" */
  resolveColorHex: (ref: string) => string | null;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getDefaultTheme(),
  extend: {},
  version: 3,
  cssTheme: {},
  tokens: null,
  loading: false,

  async loadTheme() {
    set({ loading: true });
    try {
      const result = await api.getTheme();
      const { extend, version = 3, cssTheme = {} } = result as any;
      const theme = getDefaultTheme();

      // Merge project extensions into defaults
      if (extend.colors) {
        for (const [name, value] of Object.entries(extend.colors)) {
          if (typeof value === "object" && value !== null) {
            theme.colors[name] = value as Record<string, string>;
          }
        }
      }
      if (extend.spacing) {
        Object.assign(theme.spacing, extend.spacing);
      }
      if (extend.fontSize) {
        Object.assign(theme.fontSize, extend.fontSize);
      }
      if (extend.screens) {
        Object.assign(theme.screens, extend.screens);
      }

      set({ theme, extend, version, cssTheme, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async loadTokens() {
    try {
      const { tokens } = await api.getTokens();
      set({ tokens: tokens as DesignTokens });
    } catch {
      // Use defaults
    }
  },

  async updateTokens(tokens) {
    set({ tokens });
    await api.saveTokens(tokens);
  },

  async updateThemeExtend(extend) {
    set({ extend });
    await api.updateTheme(extend);
    // Reload theme to get merged result
    get().loadTheme();
  },

  getColorNames() {
    return Object.keys(get().theme.colors);
  },

  getColorShades(name: string) {
    return get().theme.colors[name] || {};
  },

  resolveColorHex(ref: string) {
    if (ref === "white") return "#ffffff";
    if (ref === "black") return "#000000";
    if (ref === "transparent") return "transparent";

    const match = ref.match(/^(\w+)-(\d+)$/);
    if (!match) return null;
    const [, name, shade] = match;
    const shades = get().theme.colors[name];
    return shades?.[shade] || null;
  },
}));
