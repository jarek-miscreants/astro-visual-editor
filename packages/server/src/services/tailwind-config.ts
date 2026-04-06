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
      // Write to v3 JS config
      const { extend } = await readTailwindConfig(projectPath);
      const tokenColors: Record<string, string> = {};

      // Default Tailwind color hex values for resolving token references
      const DEFAULT_HEX: Record<string, string> = {
        "white": "#ffffff", "black": "#000000", "transparent": "transparent",
      };

      for (const [name, twRef] of Object.entries(tokens.colors as Record<string, string>)) {
        // Store as a reference — Tailwind v3 can't use cross-references,
        // so we just store the class name for the editor's use.
        // For actual config, we'd need the hex value.
        tokenColors[name] = twRef as string;
      }

      // Merge token colors into extend.colors
      const newExtend = {
        ...extend,
        colors: {
          ...(extend.colors || {}),
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
