import { Router } from "express";
import {
  readTailwindConfig,
  readDesignTokens,
  writeDesignTokens,
  updateTailwindConfig,
  detectTailwindVersion,
  writeCssTheme,
} from "../services/tailwind-config.js";

export const configRouter = Router();

/** GET /api/config/theme — Returns the project's Tailwind theme config */
configRouter.get("/theme", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { config, extend, version, cssTheme } = await readTailwindConfig(projectPath);
    res.json({ extend, content: config?.content || [], version, cssTheme: cssTheme || {} });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/config/theme — Update theme config (v3: extend, v4: cssTheme) */
configRouter.post("/theme", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { extend, cssTheme } = req.body;

    if (cssTheme && typeof cssTheme === "object") {
      // v4: write CSS @theme variables
      const detected = await detectTailwindVersion(projectPath);
      if (detected.cssPath) {
        await writeCssTheme(detected.cssPath, cssTheme);
        res.json({ success: true });
        return;
      }
    }

    if (extend && typeof extend === "object") {
      // v3: write to tailwind.config.mjs
      await updateTailwindConfig(projectPath, extend);
      res.json({ success: true });
      return;
    }

    res.status(400).json({ error: "Provide either extend or cssTheme" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/config/tokens — Returns design tokens */
configRouter.get("/tokens", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const tokens = await readDesignTokens(projectPath);
    res.json({ tokens: tokens || getDefaultTokens() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/config/tokens — Save design tokens */
configRouter.post("/tokens", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const { tokens } = req.body;
    if (!tokens || typeof tokens !== "object") {
      res.status(400).json({ error: "tokens must be an object" });
      return;
    }
    await writeDesignTokens(projectPath, tokens);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getDefaultTokens() {
  return {
    colors: {
      primary: "blue-600",
      secondary: "purple-600",
      accent: "amber-500",
      background: "white",
      surface: "gray-50",
      text: "gray-900",
      muted: "gray-500",
      border: "gray-200",
      error: "red-600",
      success: "green-600",
      warning: "yellow-500",
    },
    typography: {
      fontFamily: { heading: "sans-serif", body: "sans-serif", mono: "monospace" },
      scale: {
        h1: { size: "text-4xl", weight: "font-bold", lineHeight: "leading-tight" },
        h2: { size: "text-3xl", weight: "font-bold", lineHeight: "leading-tight" },
        h3: { size: "text-2xl", weight: "font-semibold", lineHeight: "leading-snug" },
        h4: { size: "text-xl", weight: "font-semibold", lineHeight: "leading-snug" },
        body: { size: "text-base", weight: "font-normal", lineHeight: "leading-normal" },
        small: { size: "text-sm", weight: "font-normal", lineHeight: "leading-normal" },
        caption: { size: "text-xs", weight: "font-medium", lineHeight: "leading-normal" },
      },
    },
    spacing: {
      page: "max-w-7xl mx-auto px-4",
      section: "py-16",
      card: "p-6",
      gap: "gap-6",
    },
    radii: {
      default: "rounded-lg",
      small: "rounded",
      full: "rounded-full",
    },
    shadows: {
      default: "shadow-md",
      elevated: "shadow-xl",
    },
  };
}
