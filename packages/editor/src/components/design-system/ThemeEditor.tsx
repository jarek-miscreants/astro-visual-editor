import { useState } from "react";
import { Plus, Trash2, Info } from "lucide-react";
import { api } from "../../lib/api-client";

interface ThemeEditorProps {
  /** Current @theme CSS variables or v3 extend values */
  cssTheme: Record<string, string>;
  version: 3 | 4;
  onSave: () => void;
}

/** Categories of @theme variables with examples */
const THEME_CATEGORIES = [
  {
    name: "Colors",
    prefix: "color",
    description: "Custom colors. Creates bg-{name}, text-{name}, border-{name} utilities.",
    examples: [
      { key: "color-brand", value: "#6366f1", hint: "bg-brand, text-brand" },
      { key: "color-brand-light", value: "#818cf8", hint: "bg-brand-light" },
      { key: "color-brand-dark", value: "#4338ca", hint: "bg-brand-dark" },
      { key: "color-surface", value: "#f8fafc", hint: "bg-surface" },
      { key: "color-on-surface", value: "#0f172a", hint: "text-on-surface" },
    ],
  },
  {
    name: "Font Size",
    prefix: "font-size",
    description: "Custom text sizes. Creates text-{name} utilities.",
    examples: [
      { key: "font-size-hero", value: "4.5rem", hint: "text-hero" },
      { key: "font-size-display", value: "3.5rem", hint: "text-display" },
      { key: "font-size-title", value: "2rem", hint: "text-title" },
      { key: "font-size-body-lg", value: "1.125rem", hint: "text-body-lg" },
      { key: "font-size-body", value: "1rem", hint: "text-body" },
      { key: "font-size-caption", value: "0.75rem", hint: "text-caption" },
    ],
  },
  {
    name: "Font Family",
    prefix: "font-family",
    description: "Custom font stacks. Creates font-{name} utilities.",
    examples: [
      { key: "font-family-heading", value: "'Playfair Display', serif", hint: "font-heading" },
      { key: "font-family-body", value: "'Inter', sans-serif", hint: "font-body" },
      { key: "font-family-code", value: "'JetBrains Mono', monospace", hint: "font-code" },
    ],
  },
  {
    name: "Spacing",
    prefix: "spacing",
    description: "Custom spacing values. Extends p-{name}, m-{name}, gap-{name}, etc.",
    examples: [
      { key: "spacing-section", value: "6rem", hint: "py-section" },
      { key: "spacing-card", value: "2rem", hint: "p-card" },
      { key: "spacing-gutter", value: "1.5rem", hint: "gap-gutter, px-gutter" },
    ],
  },
  {
    name: "Breakpoints",
    prefix: "breakpoint",
    description: "Custom responsive breakpoints. Creates {name}: prefix for responsive classes.",
    examples: [
      { key: "breakpoint-xs", value: "480px", hint: "xs:flex, xs:hidden" },
      { key: "breakpoint-sm", value: "640px", hint: "sm: (default)" },
      { key: "breakpoint-md", value: "768px", hint: "md: (default)" },
      { key: "breakpoint-lg", value: "1024px", hint: "lg: (default)" },
      { key: "breakpoint-xl", value: "1280px", hint: "xl: (default)" },
      { key: "breakpoint-2xl", value: "1536px", hint: "2xl: (default)" },
      { key: "breakpoint-3xl", value: "1920px", hint: "3xl:max-w-screen-3xl" },
    ],
  },
  {
    name: "Container / Max Width",
    prefix: "container",
    description: "Custom container widths. Creates max-w-{name} utilities.",
    examples: [
      { key: "container-narrow", value: "640px", hint: "max-w-narrow" },
      { key: "container-content", value: "768px", hint: "max-w-content" },
      { key: "container-wide", value: "1280px", hint: "max-w-wide" },
      { key: "container-full", value: "1536px", hint: "max-w-full-hd" },
    ],
  },
  {
    name: "Border Radius",
    prefix: "radius",
    description: "Custom radii. Creates rounded-{name} utilities.",
    examples: [
      { key: "radius-card", value: "1rem", hint: "rounded-card" },
      { key: "radius-button", value: "0.5rem", hint: "rounded-button" },
      { key: "radius-pill", value: "9999px", hint: "rounded-pill" },
    ],
  },
  {
    name: "Shadows",
    prefix: "shadow",
    description: "Custom box shadows. Creates shadow-{name} utilities.",
    examples: [
      { key: "shadow-card", value: "0 4px 12px rgba(0,0,0,0.08)", hint: "shadow-card" },
      { key: "shadow-elevated", value: "0 12px 40px rgba(0,0,0,0.12)", hint: "shadow-elevated" },
    ],
  },
];

export function ThemeEditor({ cssTheme, version, onSave }: ThemeEditorProps) {
  const [variables, setVariables] = useState<Record<string, string>>(cssTheme);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  function updateVar(key: string, value: string) {
    setVariables((prev) => ({ ...prev, [key]: value }));
  }

  function removeVar(key: string) {
    setVariables((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addVar(key: string, value: string) {
    if (!key) return;
    // Ensure CSS variable format
    const cssKey = key.startsWith("--") ? key.slice(2) : key;
    setVariables((prev) => ({ ...prev, [cssKey]: value }));
    setNewKey("");
    setNewValue("");
  }

  function addFromExample(key: string, value: string) {
    if (!variables[key]) {
      setVariables((prev) => ({ ...prev, [key]: value }));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (version === 4) {
        // For v4: write @theme CSS variables
        // The server handles this via writeCssTheme
        await fetch("/api/config/theme", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cssTheme: variables }),
        });
      } else {
        // For v3: convert variables to theme.extend format
        const extend: Record<string, any> = {};
        for (const [key, value] of Object.entries(variables)) {
          if (key.startsWith("color-")) {
            if (!extend.colors) extend.colors = {};
            extend.colors[key.replace("color-", "")] = value;
          } else if (key.startsWith("font-size-")) {
            if (!extend.fontSize) extend.fontSize = {};
            extend.fontSize[key.replace("font-size-", "")] = value;
          } else if (key.startsWith("font-family-")) {
            if (!extend.fontFamily) extend.fontFamily = {};
            extend.fontFamily[key.replace("font-family-", "")] = value.split(",").map((s) => s.trim());
          } else if (key.startsWith("spacing-")) {
            if (!extend.spacing) extend.spacing = {};
            extend.spacing[key.replace("spacing-", "")] = value;
          } else if (key.startsWith("radius-")) {
            if (!extend.borderRadius) extend.borderRadius = {};
            extend.borderRadius[key.replace("radius-", "")] = value;
          } else if (key.startsWith("shadow-")) {
            if (!extend.boxShadow) extend.boxShadow = {};
            extend.boxShadow[key.replace("shadow-", "")] = value;
          } else if (key.startsWith("breakpoint-")) {
            if (!extend.screens) extend.screens = {};
            extend.screens[key.replace("breakpoint-", "")] = value;
          } else if (key.startsWith("container-")) {
            if (!extend.maxWidth) extend.maxWidth = {};
            extend.maxWidth[key.replace("container-", "")] = value;
          }
        }
        await api.updateTheme(extend);
      }
      onSave();
    } catch (err) {
      console.error("Failed to save theme:", err);
    } finally {
      setSaving(false);
    }
  }

  // Group variables by category
  const grouped: Record<string, Array<{ key: string; value: string }>> = {};
  const uncategorized: Array<{ key: string; value: string }> = [];

  for (const [key, value] of Object.entries(variables)) {
    const cat = THEME_CATEGORIES.find((c) => key.startsWith(c.prefix));
    if (cat) {
      if (!grouped[cat.name]) grouped[cat.name] = [];
      grouped[cat.name].push({ key, value });
    } else {
      uncategorized.push({ key, value });
    }
  }

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="shrink-0 text-blue-400 mt-0.5" />
          <div className="text-[11px] text-blue-300 space-y-1">
            <p>
              {version === 4
                ? "Define design tokens as CSS variables inside @theme. Each variable creates Tailwind utilities automatically."
                : "Define design tokens that map to theme.extend in tailwind.config.mjs. Each creates Tailwind utilities."}
            </p>
            <p className="text-blue-400/70">
              Example: <code className="font-mono">font-size-hero: 4.5rem</code> → use <code className="font-mono">text-hero</code> class
            </p>
          </div>
        </div>
      </div>

      {/* Categories with current values + examples */}
      {THEME_CATEGORIES.map((cat) => {
        const existing = grouped[cat.name] || [];
        return (
          <div key={cat.name}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-zinc-300">{cat.name}</h3>
              <span className="text-[9px] text-zinc-600">{cat.description}</span>
            </div>

            {/* Existing variables */}
            <div className="space-y-1">
              {existing.map(({ key, value }) => {
                const example = cat.examples.find((e) => e.key === key);
                return (
                  <div key={key} className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5">
                    {key.startsWith("color") && (
                      <input
                        type="color"
                        value={value}
                        onChange={(e) => updateVar(key, e.target.value)}
                        className="h-5 w-5 shrink-0 cursor-pointer rounded border border-zinc-600 bg-transparent p-0"
                      />
                    )}
                    <code className="shrink-0 text-[10px] text-zinc-400">--{key}</code>
                    <input
                      value={value}
                      onChange={(e) => updateVar(key, e.target.value)}
                      className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
                    />
                    {example && (
                      <code className="shrink-0 text-[9px] text-zinc-600">{example.hint}</code>
                    )}
                    <button onClick={() => removeVar(key)} className="shrink-0 text-zinc-600 hover:text-red-400">
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Quick-add from examples */}
            {cat.examples.filter((e) => !variables[e.key]).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {cat.examples
                  .filter((e) => !variables[e.key])
                  .map((e) => (
                    <button
                      key={e.key}
                      onClick={() => addFromExample(e.key, e.value)}
                      className="rounded bg-zinc-800/60 border border-zinc-700/50 border-dashed px-1.5 py-0.5 text-[9px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400 hover:border-zinc-600"
                    >
                      + {e.key.replace(cat.prefix + "-", "")}
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Uncategorized */}
      {uncategorized.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-zinc-300">Other</h3>
          <div className="space-y-1">
            {uncategorized.map(({ key, value }) => (
              <div key={key} className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1.5">
                <code className="shrink-0 text-[10px] text-zinc-400">--{key}</code>
                <input
                  value={value}
                  onChange={(e) => updateVar(key, e.target.value)}
                  className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
                />
                <button onClick={() => removeVar(key)} className="shrink-0 text-zinc-600 hover:text-red-400">
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add custom variable */}
      <div>
        <div className="mb-1 text-[10px] text-zinc-500">Add Custom Variable</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-500">--</span>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="variable-name"
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
            onKeyDown={(e) => e.key === "Enter" && addVar(newKey, newValue)}
          />
          <button
            onClick={() => addVar(newKey, newValue)}
            disabled={!newKey}
            className="flex items-center gap-1 rounded bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            <Plus size={10} />
          </button>
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving..." : "Save to Tailwind Config"}
      </button>
    </div>
  );
}
