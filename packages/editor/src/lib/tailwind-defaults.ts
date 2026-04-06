/**
 * Single source of truth for default Tailwind v3 theme values.
 * All controls, alternatives, and class databases read from here.
 * When the theme store loads a project config, it merges on top of these.
 */

export interface TailwindTheme {
  colors: Record<string, Record<string, string>>;
  spacing: Record<string, string>;
  fontSize: Record<string, string>;
  fontWeight: Record<string, string>;
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  screens: Record<string, string>;
  lineHeight: Record<string, string>;
  letterSpacing: Record<string, string>;
}

export const DEFAULT_COLORS: Record<string, Record<string, string>> = {
  slate: { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617" },
  gray: { 50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280", 600: "#4b5563", 700: "#374151", 800: "#1f2937", 900: "#111827", 950: "#030712" },
  zinc: { 50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8", 400: "#a1a1aa", 500: "#71717a", 600: "#52525b", 700: "#3f3f46", 800: "#27272a", 900: "#18181b", 950: "#09090b" },
  red: { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a" },
  orange: { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407" },
  yellow: { 50: "#fefce8", 100: "#fef9c3", 200: "#fef08a", 300: "#fde047", 400: "#facc15", 500: "#eab308", 600: "#ca8a04", 700: "#a16207", 800: "#854d0e", 900: "#713f12", 950: "#422006" },
  green: { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16" },
  blue: { 50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a", 950: "#172554" },
  indigo: { 50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81", 950: "#1e1b4b" },
  purple: { 50: "#faf5ff", 100: "#f3e8ff", 200: "#e9d5ff", 300: "#d8b4fe", 400: "#c084fc", 500: "#a855f7", 600: "#9333ea", 700: "#7e22ce", 800: "#6b21a8", 900: "#581c87", 950: "#3b0764" },
  pink: { 50: "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d", 900: "#831843", 950: "#500724" },
};

export const DEFAULT_SPACING: Record<string, string> = {
  "0": "0px", "px": "1px", "0.5": "0.125rem", "1": "0.25rem", "1.5": "0.375rem",
  "2": "0.5rem", "2.5": "0.625rem", "3": "0.75rem", "3.5": "0.875rem", "4": "1rem",
  "5": "1.25rem", "6": "1.5rem", "7": "1.75rem", "8": "2rem", "9": "2.25rem",
  "10": "2.5rem", "11": "2.75rem", "12": "3rem", "14": "3.5rem", "16": "4rem",
  "20": "5rem", "24": "6rem", "28": "7rem", "32": "8rem", "36": "9rem",
  "40": "10rem", "44": "11rem", "48": "12rem", "52": "13rem", "56": "14rem",
  "60": "15rem", "64": "16rem", "72": "18rem", "80": "20rem", "96": "24rem",
};

export const DEFAULT_FONT_SIZE: Record<string, string> = {
  xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem",
  xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem",
  "5xl": "3rem", "6xl": "3.75rem", "7xl": "4.5rem", "8xl": "6rem", "9xl": "8rem",
};

export const DEFAULT_FONT_WEIGHT: Record<string, string> = {
  thin: "100", extralight: "200", light: "300", normal: "400",
  medium: "500", semibold: "600", bold: "700", extrabold: "800", black: "900",
};

export const DEFAULT_BORDER_RADIUS: Record<string, string> = {
  none: "0px", sm: "0.125rem", DEFAULT: "0.25rem", md: "0.375rem",
  lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem", full: "9999px",
};

export const DEFAULT_BOX_SHADOW: Record<string, string> = {
  sm: "0 1px 2px rgba(0,0,0,0.05)",
  DEFAULT: "0 1px 3px rgba(0,0,0,0.1)",
  md: "0 4px 6px rgba(0,0,0,0.1)",
  lg: "0 10px 15px rgba(0,0,0,0.1)",
  xl: "0 20px 25px rgba(0,0,0,0.1)",
  "2xl": "0 25px 50px rgba(0,0,0,0.25)",
  none: "none",
};

export const DEFAULT_SCREENS: Record<string, string> = {
  sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1536px",
};

export const DEFAULT_LINE_HEIGHT: Record<string, string> = {
  none: "1", tight: "1.25", snug: "1.375", normal: "1.5", relaxed: "1.625", loose: "2",
};

export const DEFAULT_LETTER_SPACING: Record<string, string> = {
  tighter: "-0.05em", tight: "-0.025em", normal: "0em",
  wide: "0.025em", wider: "0.05em", widest: "0.1em",
};

export const COLOR_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

export const SPACING_SCALE = Object.keys(DEFAULT_SPACING);

/** Get default theme */
export function getDefaultTheme(): TailwindTheme {
  return {
    colors: DEFAULT_COLORS,
    spacing: DEFAULT_SPACING,
    fontSize: DEFAULT_FONT_SIZE,
    fontWeight: DEFAULT_FONT_WEIGHT,
    borderRadius: DEFAULT_BORDER_RADIUS,
    boxShadow: DEFAULT_BOX_SHADOW,
    screens: DEFAULT_SCREENS,
    lineHeight: DEFAULT_LINE_HEIGHT,
    letterSpacing: DEFAULT_LETTER_SPACING,
  };
}
