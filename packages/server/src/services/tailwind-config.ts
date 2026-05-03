import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

export interface ResolvedTheme {
  colors: Record<string, string | Record<string, string>>;
  spacing: Record<string, string>;
  fontSize: Record<string, string | [string, any]>;
  fontWeight: Record<string, string>;
  fontFamily: Record<string, string[]>;
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  screens: Record<string, string>;
  extend: Record<string, any>;
}

const CONFIG_FILES = [
  "tailwind.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
];

/** Default Tailwind v3 palette — used to resolve token class refs (e.g.
 *  "blue-600") to a real hex value when writing extend.colors. v3 cannot
 *  cross-reference palette entries by class name. */
const DEFAULT_PALETTE: Record<string, Record<string, string>> = {
  slate:   { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617" },
  gray:    { 50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280", 600: "#4b5563", 700: "#374151", 800: "#1f2937", 900: "#111827", 950: "#030712" },
  zinc:    { 50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8", 400: "#a1a1aa", 500: "#71717a", 600: "#52525b", 700: "#3f3f46", 800: "#27272a", 900: "#18181b", 950: "#09090b" },
  neutral: { 50: "#fafafa", 100: "#f5f5f5", 200: "#e5e5e5", 300: "#d4d4d4", 400: "#a3a3a3", 500: "#737373", 600: "#525252", 700: "#404040", 800: "#262626", 900: "#171717", 950: "#0a0a0a" },
  stone:   { 50: "#fafaf9", 100: "#f5f5f4", 200: "#e7e5e4", 300: "#d6d3d1", 400: "#a8a29e", 500: "#78716c", 600: "#57534e", 700: "#44403c", 800: "#292524", 900: "#1c1917", 950: "#0c0a09" },
  red:     { 50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444", 600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a" },
  orange:  { 50: "#fff7ed", 100: "#ffedd5", 200: "#fed7aa", 300: "#fdba74", 400: "#fb923c", 500: "#f97316", 600: "#ea580c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407" },
  amber:   { 50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03" },
  yellow:  { 50: "#fefce8", 100: "#fef9c3", 200: "#fef08a", 300: "#fde047", 400: "#facc15", 500: "#eab308", 600: "#ca8a04", 700: "#a16207", 800: "#854d0e", 900: "#713f12", 950: "#422006" },
  lime:    { 50: "#f7fee7", 100: "#ecfccb", 200: "#d9f99d", 300: "#bef264", 400: "#a3e635", 500: "#84cc16", 600: "#65a30d", 700: "#4d7c0f", 800: "#3f6212", 900: "#365314", 950: "#1a2e05" },
  green:   { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80", 500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d", 950: "#052e16" },
  emerald: { 50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22" },
  teal:    { 50: "#f0fdfa", 100: "#ccfbf1", 200: "#99f6e4", 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59", 900: "#134e4a", 950: "#042f2e" },
  cyan:    { 50: "#ecfeff", 100: "#cffafe", 200: "#a5f3fc", 300: "#67e8f9", 400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2", 700: "#0e7490", 800: "#155e75", 900: "#164e63", 950: "#083344" },
  sky:     { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49" },
  blue:    { 50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a", 950: "#172554" },
  indigo:  { 50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81", 950: "#1e1b4b" },
  violet:  { 50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065" },
  purple:  { 50: "#faf5ff", 100: "#f3e8ff", 200: "#e9d5ff", 300: "#d8b4fe", 400: "#c084fc", 500: "#a855f7", 600: "#9333ea", 700: "#7e22ce", 800: "#6b21a8", 900: "#581c87", 950: "#3b0764" },
  fuchsia: { 50: "#fdf4ff", 100: "#fae8ff", 200: "#f5d0fe", 300: "#f0abfc", 400: "#e879f9", 500: "#d946ef", 600: "#c026d3", 700: "#a21caf", 800: "#86198f", 900: "#701a75", 950: "#4a044e" },
  pink:    { 50: "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d", 900: "#831843", 950: "#500724" },
  rose:    { 50: "#fff1f2", 100: "#ffe4e4", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239", 900: "#881337", 950: "#4c0519" },
};

const SINGLE_COLORS: Record<string, string> = {
  white:       "#ffffff",
  black:       "#000000",
  transparent: "transparent",
  current:     "currentColor",
  inherit:     "inherit",
};

/** Resolve a Tailwind class reference like "blue-600" or "primary" to a hex
 *  value, looking first in the project's existing extend.colors palette,
 *  then in the default Tailwind v3 palette. Falls back to the original ref
 *  string if nothing matches (caller can still use it as a CSS var name). */
export function resolveTwColorRef(
  ref: string,
  projectColors: Record<string, any> = {}
): string {
  if (!ref) return ref;
  const trimmed = ref.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("rgb") || trimmed.startsWith("hsl")) {
    return trimmed;
  }
  if (SINGLE_COLORS[trimmed]) return SINGLE_COLORS[trimmed];

  const dashIdx = trimmed.lastIndexOf("-");
  const family = dashIdx === -1 ? trimmed : trimmed.slice(0, dashIdx);
  const shade  = dashIdx === -1 ? null    : trimmed.slice(dashIdx + 1);

  // Project palette first — supports custom families overriding defaults
  const projectFamily = projectColors[family];
  if (projectFamily) {
    if (typeof projectFamily === "string") return projectFamily;
    if (shade && projectFamily[shade]) return projectFamily[shade];
  }
  // Singletons defined directly under extend.colors (no shade)
  if (typeof projectColors[trimmed] === "string") return projectColors[trimmed];

  // Default palette
  const defaultFamily = DEFAULT_PALETTE[family];
  if (defaultFamily && shade && defaultFamily[shade]) return defaultFamily[shade];
  if (defaultFamily && !shade && defaultFamily["500"]) return defaultFamily["500"];

  // Last resort — return the ref untouched so the user can fix it manually
  return trimmed;
}

/** CSS files that may contain Tailwind v4 @theme directives */
const CSS_ENTRY_FILES = [
  "src/styles/global.css",
  "src/styles/app.css",
  "src/styles/main.css",
  "src/assets/styles/global.css",
  "src/global.css",
  "src/app.css",
];

/**
 * Detect whether project uses Tailwind v3 (JS config) or v4 (CSS @theme).
 */
export async function detectTailwindVersion(
  projectPath: string
): Promise<{ version: 3 | 4; configPath: string | null; cssPath: string | null }> {
  // Check for v4 CSS @theme
  for (const file of CSS_ENTRY_FILES) {
    const fullPath = path.join(projectPath, file);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      if (content.includes("@theme") || content.includes("@import \"tailwindcss\"")) {
        return { version: 4, configPath: null, cssPath: fullPath };
      }
    } catch {
      continue;
    }
  }

  // Check for v3 JS config
  for (const file of CONFIG_FILES) {
    const fullPath = path.join(projectPath, file);
    try {
      await fs.access(fullPath);
      return { version: 3, configPath: fullPath, cssPath: null };
    } catch {
      continue;
    }
  }

  return { version: 3, configPath: null, cssPath: null };
}

/**
 * Read Tailwind v3 JS config.
 */
export async function readTailwindConfig(
  projectPath: string
): Promise<{ config: any; extend: Record<string, any>; version: 3 | 4; cssTheme?: Record<string, string> }> {
  const detected = await detectTailwindVersion(projectPath);

  if (detected.version === 4 && detected.cssPath) {
    const cssTheme = await readCssTheme(detected.cssPath);
    return { config: {}, extend: {}, version: 4, cssTheme };
  }

  if (!detected.configPath) {
    return { config: {}, extend: {}, version: 3 };
  }

  try {
    const configUrl = pathToFileURL(detected.configPath).href;
    const module = await import(`${configUrl}?t=${Date.now()}`);
    const config = module.default || module;
    const extend = config?.theme?.extend || {};
    return { config, extend, version: 3 };
  } catch (err) {
    console.error("[TailwindConfig] Failed to read config:", err);
    return { config: {}, extend: {}, version: 3 };
  }
}

/**
 * Read CSS @theme variables from a Tailwind v4 CSS file.
 */
async function readCssTheme(cssPath: string): Promise<Record<string, string>> {
  const content = await fs.readFile(cssPath, "utf-8");
  const theme: Record<string, string> = {};

  // Parse @theme { --color-primary: #3b82f6; ... }
  const themeMatch = content.match(/@theme\s*\{([^}]*)\}/s);
  if (themeMatch) {
    const block = themeMatch[1];
    const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
    let match;
    while ((match = varRegex.exec(block)) !== null) {
      theme[match[1]] = match[2].trim();
    }
  }

  return theme;
}

/**
 * Write CSS @theme variables to a Tailwind v4 CSS file.
 */
export async function writeCssTheme(
  cssPath: string,
  variables: Record<string, string>
): Promise<void> {
  let content = await fs.readFile(cssPath, "utf-8");

  const varLines = Object.entries(variables)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");

  const themeBlock = `@theme {\n${varLines}\n}`;

  if (content.includes("@theme")) {
    content = content.replace(/@theme\s*\{[^}]*\}/s, themeBlock);
  } else {
    content += `\n\n${themeBlock}\n`;
  }

  await fs.writeFile(cssPath, content, "utf-8");
}

/**
 * Read design tokens from the project's tve-tokens.json file.
 */
export async function readDesignTokens(
  projectPath: string
): Promise<Record<string, any> | null> {
  const tokensPath = path.join(projectPath, "tve-tokens.json");
  try {
    const content = await fs.readFile(tokensPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write design tokens to tve-tokens.json AND sync to Tailwind config.
 * Token colors become actual theme colors (bg-primary, text-error, etc.).
 */
export async function writeDesignTokens(
  projectPath: string,
  tokens: Record<string, any>
): Promise<void> {
  // Save tokens file
  const tokensPath = path.join(projectPath, "tve-tokens.json");
  await fs.writeFile(tokensPath, JSON.stringify(tokens, null, 2), "utf-8");

  // Sync token colors to Tailwind config
  if (tokens.colors && typeof tokens.colors === "object") {
    const detected = await detectTailwindVersion(projectPath);

    if (detected.version === 4 && detected.cssPath) {
      // Write as CSS variables for v4
      const cssVars: Record<string, string> = {};
      // Read existing theme first
      const existing = await readCssTheme(detected.cssPath);
      Object.assign(cssVars, existing);

      for (const [name, twRef] of Object.entries(tokens.colors)) {
        // Convert Tailwind ref to CSS variable: "blue-600" -> var(--color-blue-600)
        cssVars[`color-${name}`] = `var(--color-${twRef})`;
      }
      await writeCssTheme(detected.cssPath, cssVars);
    } else {
      // Write to v3 JS config — resolve Tailwind class refs ("blue-600") to
      // real hex values so generated tokens (bg-primary, text-error, …)
      // compile to valid CSS. v3's extend.colors expects color values, not
      // class names.
      const { extend } = await readTailwindConfig(projectPath);
      const tokenColors: Record<string, string> = {};
      const projectExtendColors = (extend.colors || {}) as Record<string, any>;

      for (const [name, twRef] of Object.entries(tokens.colors as Record<string, string>)) {
        tokenColors[name] = resolveTwColorRef(twRef, projectExtendColors);
      }

      // Merge token colors into extend.colors
      const newExtend = {
        ...extend,
        colors: {
          ...projectExtendColors,
          ...tokenColors,
        },
      };

      await updateTailwindConfig(projectPath, newExtend);
    }
  }
}

/**
 * Update the tailwind.config.mjs with new theme.extend values (v3).
 */
export async function updateTailwindConfig(
  projectPath: string,
  extend: Record<string, any>
): Promise<void> {
  let configPath: string | null = null;
  for (const file of CONFIG_FILES) {
    const fullPath = path.join(projectPath, file);
    try {
      await fs.access(fullPath);
      configPath = fullPath;
      break;
    } catch {
      continue;
    }
  }

  if (!configPath) {
    configPath = path.join(projectPath, "tailwind.config.mjs");
  }

  const content = await fs.readFile(configPath, "utf-8");

  // Build the extend object as JS source
  const extendStr = JSON.stringify(extend, null, 6)
    .replace(/"([^"]+)":/g, "$1:");

  let newContent: string;
  if (content.includes("extend:")) {
    // Replace existing extend block (handle nested braces)
    newContent = content.replace(
      /extend:\s*\{[\s\S]*?\n\s{4}\}/,
      `extend: ${extendStr}`
    );
  } else if (content.includes("theme:")) {
    // Add extend inside existing theme
    newContent = content.replace(
      /theme:\s*\{/,
      `theme: {\n    extend: ${extendStr},`
    );
  } else {
    // No theme at all — shouldn't happen with Tailwind projects
    newContent = content;
  }

  await fs.writeFile(configPath, newContent, "utf-8");
}
