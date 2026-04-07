import { useState } from "react";
import { X, Download, Upload, Palette, Type, Space, Circle, Plus, Trash2, Paintbrush } from "lucide-react";
import { useThemeStore, type DesignTokens } from "../../store/theme-store";
import { DEFAULT_COLORS, COLOR_SHADES } from "../../lib/tailwind-defaults";
import { ThemeEditor } from "./ThemeEditor";

interface DesignSystemPanelProps {
  onClose: () => void;
}

type DSTab = "theme" | "colors" | "fonts" | "spacing" | "tokens";

export function DesignSystemPanel({ onClose }: DesignSystemPanelProps) {
  const [activeTab, setActiveTab] = useState<DSTab>("theme");
  const theme = useThemeStore((s) => s.theme);
  const extend = useThemeStore((s) => s.extend);
  const tokens = useThemeStore((s) => s.tokens);
  const updateTokens = useThemeStore((s) => s.updateTokens);
  const updateThemeExtend = useThemeStore((s) => s.updateThemeExtend);
  const loadTheme = useThemeStore((s) => s.loadTheme);

  return (
    <div className="fixed inset-0 z-[9999] flex items-stretch bg-black/50">
      <div className="m-4 flex flex-1 flex-col  border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Design System</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (tokens) {
                  const blob = new Blob([JSON.stringify(tokens, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "tve-tokens.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }}
              className="flex items-center gap-1  px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <Download size={12} />
              Export
            </button>
            <button
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  try {
                    const imported = JSON.parse(await file.text());
                    updateTokens(imported);
                  } catch {
                    alert("Invalid JSON file");
                  }
                };
                input.click();
              }}
              className="flex items-center gap-1  px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <Upload size={12} />
              Import
            </button>
            <button onClick={onClose} className=" p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {([
            { id: "theme" as DSTab, label: "@theme", icon: <Paintbrush size={12} /> },
            { id: "colors" as DSTab, label: "Colors", icon: <Palette size={12} /> },
            { id: "fonts" as DSTab, label: "Fonts", icon: <Type size={12} /> },
            { id: "spacing" as DSTab, label: "Spacing", icon: <Space size={12} /> },
            { id: "tokens" as DSTab, label: "Tokens", icon: <Circle size={12} /> },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === "theme" && (
            <ThemeEditor
              cssTheme={useThemeStore.getState().cssTheme}
              version={useThemeStore.getState().version}
              onSave={() => {
                loadTheme();
              }}
            />
          )}
          {activeTab === "colors" && (
            <ColorsEditor
              theme={theme}
              extend={extend}
              onUpdateExtend={updateThemeExtend}
            />
          )}
          {activeTab === "fonts" && (
            <>
              <FontsEditor extend={extend} onUpdateExtend={updateThemeExtend} />
              <div className="mt-6 border-t border-zinc-800 pt-6">
                <TypeScalePreview theme={theme} />
              </div>
            </>
          )}
          {activeTab === "spacing" && (
            <SpacingEditor theme={theme} />
          )}
          {activeTab === "tokens" && tokens && (
            <TokenEditor tokens={tokens} onUpdate={updateTokens} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Colors Editor ──────────────────────────────────────────

function ColorsEditor({
  theme,
  extend,
  onUpdateExtend,
}: {
  theme: any;
  extend: Record<string, any>;
  onUpdateExtend: (extend: Record<string, any>) => Promise<void>;
}) {
  const [newColorName, setNewColorName] = useState("");

  function addCustomColor() {
    if (!newColorName || !/^[a-z][a-z0-9-]*$/.test(newColorName)) return;
    const newExtend = {
      ...extend,
      colors: {
        ...(extend.colors || {}),
        [newColorName]: {
          50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8",
          400: "#a1a1aa", 500: "#71717a", 600: "#52525b", 700: "#3f3f46",
          800: "#27272a", 900: "#18181b", 950: "#09090b",
        },
      },
    };
    onUpdateExtend(newExtend);
    setNewColorName("");
  }

  function removeCustomColor(name: string) {
    const colors = { ...(extend.colors || {}) };
    delete colors[name];
    onUpdateExtend({ ...extend, colors });
  }

  const customColorNames = Object.keys(extend.colors || {});

  return (
    <div className="space-y-6">
      {/* Default palette (read-only reference) */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Default Palette
        </h3>
        {Object.entries(theme.colors).map(([name, shades]) => {
          if (customColorNames.includes(name)) return null;
          return (
            <div key={name} className="mb-2">
              <div className="mb-1 text-[11px] font-medium text-zinc-300 capitalize">{name}</div>
              <div className="flex gap-1">
                {COLOR_SHADES.map((shade) => {
                  const hex = (shades as Record<string, string>)[shade];
                  if (!hex) return null;
                  return (
                    <div key={shade} className="flex flex-col items-center gap-0.5">
                      <div className="h-8 w-8  border border-zinc-700" style={{ backgroundColor: hex }} title={`${name}-${shade}: ${hex}`} />
                      <span className="text-[7px] text-zinc-600">{shade}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom colors (editable) */}
      {customColorNames.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Custom Colors
            <span className="ml-1 text-[9px] text-zinc-600 normal-case">(writes to tailwind.config.mjs)</span>
          </h3>
          {customColorNames.map((name) => {
            const shades = (extend.colors || {})[name] || {};
            return (
              <div key={name} className="mb-3  bg-zinc-800 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-zinc-300 capitalize">{name}</span>
                  <button onClick={() => removeCustomColor(name)} className="text-zinc-500 hover:text-red-400">
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="flex gap-1">
                  {COLOR_SHADES.map((shade) => (
                    <div key={shade} className="flex flex-col items-center gap-0.5">
                      <input
                        type="color"
                        value={shades[shade] || "#888888"}
                        onChange={(e) => {
                          const newColors = { ...(extend.colors || {}) };
                          newColors[name] = { ...newColors[name], [shade]: e.target.value };
                          onUpdateExtend({ ...extend, colors: newColors });
                        }}
                        className="h-8 w-8 cursor-pointer  border border-zinc-600 bg-transparent p-0"
                        title={`${name}-${shade}`}
                      />
                      <span className="text-[7px] text-zinc-600">{shade}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add custom color */}
      <div className="flex items-center gap-2">
        <input
          value={newColorName}
          onChange={(e) => setNewColorName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder="new-color-name"
          className=" bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-blue-500 font-mono"
          onKeyDown={(e) => e.key === "Enter" && addCustomColor()}
        />
        <button
          onClick={addCustomColor}
          disabled={!newColorName}
          className="flex items-center gap-1  bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <Plus size={11} />
          Add Color
        </button>
      </div>
    </div>
  );
}

// ── Fonts Editor ───────────────────────────────────────────

function FontsEditor({
  extend,
  onUpdateExtend,
}: {
  extend: Record<string, any>;
  onUpdateExtend: (extend: Record<string, any>) => Promise<void>;
}) {
  const fontFamily = extend.fontFamily || {};
  const [newFontName, setNewFontName] = useState("");

  function updateFont(name: string, value: string) {
    const families = value.split(",").map((f) => f.trim()).filter(Boolean);
    const newExtend = {
      ...extend,
      fontFamily: { ...fontFamily, [name]: families },
    };
    onUpdateExtend(newExtend);
  }

  function addFont() {
    if (!newFontName || !/^[a-z][a-z0-9]*$/.test(newFontName)) return;
    const newExtend = {
      ...extend,
      fontFamily: { ...fontFamily, [newFontName]: ["sans-serif"] },
    };
    onUpdateExtend(newExtend);
    setNewFontName("");
  }

  function removeFont(name: string) {
    const ff = { ...fontFamily };
    delete ff[name];
    onUpdateExtend({ ...extend, fontFamily: ff });
  }

  const POPULAR_FONTS = [
    "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
    "Playfair Display", "Merriweather", "Source Sans 3", "Nunito",
    "Raleway", "Work Sans", "DM Sans", "Space Grotesk", "Plus Jakarta Sans",
    "JetBrains Mono", "Fira Code", "Source Code Pro",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Font Families
        </h3>
        <p className="mb-4 text-[11px] text-zinc-500">
          Define custom font families. Use <code className="text-zinc-400">font-{"{name}"}</code> class in your elements.
          Changes write directly to <code className="text-zinc-400">tailwind.config.mjs</code>.
        </p>
      </div>

      {/* Default fonts (read-only) */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-zinc-500 uppercase">Defaults</div>
        {["sans", "serif", "mono"].map((name) => (
          <div key={name} className="flex items-center gap-3  bg-zinc-800/50 px-3 py-2">
            <code className="w-20 text-[11px] text-blue-400">font-{name}</code>
            <span className="text-xs text-zinc-400" style={{ fontFamily: name === "mono" ? "monospace" : name === "serif" ? "serif" : "sans-serif" }}>
              The quick brown fox jumps over the lazy dog
            </span>
          </div>
        ))}
      </div>

      {/* Custom fonts (editable) */}
      {Object.keys(fontFamily).length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase">
            Custom <span className="text-zinc-600 normal-case">(in tailwind.config.mjs)</span>
          </div>
          {Object.entries(fontFamily).map(([name, families]) => (
            <div key={name} className=" bg-zinc-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <code className="text-[11px] text-blue-400">font-{name}</code>
                <button onClick={() => removeFont(name)} className="text-zinc-500 hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              </div>
              <input
                value={Array.isArray(families) ? families.join(", ") : String(families)}
                onChange={(e) => updateFont(name, e.target.value)}
                placeholder="Font Name, fallback"
                className="w-full  bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-blue-500 font-mono"
              />
              <div className="text-xs text-zinc-400" style={{ fontFamily: Array.isArray(families) ? families.join(", ") : String(families) }}>
                The quick brown fox jumps over the lazy dog
              </div>

              {/* Quick-pick popular fonts */}
              <div className="flex flex-wrap gap-1">
                {POPULAR_FONTS.slice(0, 8).map((font) => (
                  <button
                    key={font}
                    onClick={() => updateFont(name, `${font}, sans-serif`)}
                    className=" bg-zinc-900 px-1.5 py-0.5 text-[9px] text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                  >
                    {font}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new font */}
      <div className="flex items-center gap-2">
        <input
          value={newFontName}
          onChange={(e) => setNewFontName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
          placeholder="fontname"
          className=" bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-blue-500 font-mono"
          onKeyDown={(e) => e.key === "Enter" && addFont()}
        />
        <button
          onClick={addFont}
          disabled={!newFontName}
          className="flex items-center gap-1  bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <Plus size={11} />
          Add Font
        </button>
      </div>

      {/* Font loading hint */}
      <div className=" border border-zinc-700 bg-zinc-800/50 p-3">
        <div className="text-[10px] font-semibold text-zinc-400 mb-1">Loading Fonts</div>
        <p className="text-[11px] text-zinc-500">
          Add a Google Fonts <code className="text-zinc-400">&lt;link&gt;</code> to your{" "}
          <code className="text-zinc-400">Layout.astro</code> &lt;head&gt; to load custom fonts:
        </p>
        {Object.entries(fontFamily).length > 0 && (
          <pre className="mt-2  bg-zinc-900 p-2 text-[10px] text-zinc-400 overflow-x-auto">
            {Object.entries(fontFamily).map(([, families]) => {
              const primary = Array.isArray(families) ? families[0] : String(families).split(",")[0].trim();
              if (!primary || primary === "sans-serif" || primary === "serif" || primary === "monospace") return null;
              return `<link href="https://fonts.googleapis.com/css2?family=${primary.replace(/ /g, "+")}:wght@400;500;600;700&display=swap" rel="stylesheet" />\n`;
            }).filter(Boolean).join("")}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Fonts Editor continued: called inside FontsEditor after font families ──

function TypeScalePreview({ theme }: { theme: any }) {
  return (
    <div className="space-y-6">
      {/* Font Size Scale */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Type Scale
        </h3>
        <div className="space-y-1">
          {Object.entries(theme.fontSize as Record<string, string>).map(([name, value]) => (
            <div key={name} className="flex items-baseline gap-3  px-2 py-1.5 hover:bg-zinc-800/50">
              <code className="w-10 shrink-0 text-right text-[10px] text-blue-400">{name}</code>
              <span className="flex-1 truncate text-zinc-200" style={{ fontSize: value }}>
                The quick brown fox
              </span>
              <span className="shrink-0 text-[9px] text-zinc-600">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Font Weight Scale */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Font Weights
        </h3>
        <div className="space-y-1">
          {Object.entries(theme.fontWeight as Record<string, string>).map(([name, value]) => (
            <div key={name} className="flex items-baseline gap-3  px-2 py-1.5 hover:bg-zinc-800/50">
              <code className="w-20 shrink-0 text-right text-[10px] text-blue-400">{name}</code>
              <span className="flex-1 text-zinc-200" style={{ fontWeight: value }}>
                The quick brown fox
              </span>
              <span className="shrink-0 text-[9px] text-zinc-600">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Spacing Scale ──────────────────────────────────────────

function SpacingEditor({ theme }: { theme: any }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Spacing Scale</h3>
      <p className="text-[11px] text-zinc-500 mb-4">
        Reference of the default Tailwind spacing scale. Used by margin, padding, gap, width, height.
      </p>
      <div className="space-y-1">
        {Object.entries(theme.spacing).map(([name, value]) => (
          <div key={name} className="flex items-center gap-3">
            <span className="w-8 text-right text-[10px] font-mono text-zinc-500">{name}</span>
            <div
              className="h-4  bg-blue-500/30 border border-blue-500/50 min-w-[2px]"
              style={{ width: `min(${value}, 100%)` }}
            />
            <span className="text-[10px] text-zinc-600">{value as string}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Token Editor ───────────────────────────────────────────

function TokenEditor({
  tokens,
  onUpdate,
}: {
  tokens: DesignTokens;
  onUpdate: (tokens: DesignTokens) => void;
}) {
  const resolveHex = useThemeStore((s) => s.resolveColorHex);
  const [newColorName, setNewColorName] = useState("");
  const [newSpacingName, setNewSpacingName] = useState("");
  const [newTypeName, setNewTypeName] = useState("");

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className=" border border-blue-500/20 bg-blue-500/5 p-3">
        <p className="text-[11px] text-blue-300">
          Tokens are synced to your Tailwind config. Color tokens become usable classes
          (e.g., <code className="font-mono">bg-primary</code>, <code className="font-mono">text-error</code>).
        </p>
      </div>

      {/* Color tokens */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Color Tokens
        </h3>
        <div className="space-y-1.5">
          {Object.entries(tokens.colors).map(([name, value]) => {
            const hex = resolveHex(value);
            return (
              <div key={name} className="flex items-center gap-2  bg-zinc-800 px-2 py-1.5">
                <div
                  className="h-5 w-5 shrink-0  border border-zinc-600"
                  style={{ backgroundColor: hex || "#888" }}
                />
                <span className="w-20 shrink-0 text-[10px] font-medium text-zinc-300">{name}</span>
                <input
                  value={value}
                  onChange={(e) => onUpdate({ ...tokens, colors: { ...tokens.colors, [name]: e.target.value } })}
                  className="flex-1  bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
                  placeholder="blue-600"
                />
                <code className="shrink-0 text-[9px] text-zinc-600">bg-{name}</code>
                <button
                  onClick={() => {
                    const c = { ...tokens.colors };
                    delete c[name];
                    onUpdate({ ...tokens, colors: c });
                  }}
                  className="shrink-0 text-zinc-600 hover:text-red-400"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newColorName}
            onChange={(e) => setNewColorName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="token-name"
            className=" bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newColorName) {
                onUpdate({ ...tokens, colors: { ...tokens.colors, [newColorName]: "gray-500" } });
                setNewColorName("");
              }
            }}
          />
          <button
            onClick={() => {
              if (newColorName) {
                onUpdate({ ...tokens, colors: { ...tokens.colors, [newColorName]: "gray-500" } });
                setNewColorName("");
              }
            }}
            disabled={!newColorName}
            className="flex items-center gap-1  bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            <Plus size={10} /> Add
          </button>
        </div>
      </div>

      {/* Typography tokens */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Typography Tokens
        </h3>
        <div className="space-y-1.5">
          {Object.entries(tokens.typography.scale).map(([name, style]) => (
            <div key={name} className="flex items-center gap-1.5  bg-zinc-800 px-2 py-1.5">
              <span className="w-14 shrink-0 text-[10px] font-medium text-zinc-300">{name}</span>
              <input
                value={style.size}
                onChange={(e) => {
                  const s = { ...tokens.typography.scale };
                  s[name] = { ...style, size: e.target.value };
                  onUpdate({ ...tokens, typography: { ...tokens.typography, scale: s } });
                }}
                className="flex-1  bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
                placeholder="text-base"
              />
              <input
                value={style.weight}
                onChange={(e) => {
                  const s = { ...tokens.typography.scale };
                  s[name] = { ...style, weight: e.target.value };
                  onUpdate({ ...tokens, typography: { ...tokens.typography, scale: s } });
                }}
                className="w-24  bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
                placeholder="font-bold"
              />
              <input
                value={style.lineHeight}
                onChange={(e) => {
                  const s = { ...tokens.typography.scale };
                  s[name] = { ...style, lineHeight: e.target.value };
                  onUpdate({ ...tokens, typography: { ...tokens.typography, scale: s } });
                }}
                className="w-24  bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
                placeholder="leading-normal"
              />
              <button
                onClick={() => {
                  const s = { ...tokens.typography.scale };
                  delete s[name];
                  onUpdate({ ...tokens, typography: { ...tokens.typography, scale: s } });
                }}
                className="shrink-0 text-zinc-600 hover:text-red-400"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="style-name"
            className=" bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTypeName) {
                const s = { ...tokens.typography.scale };
                s[newTypeName] = { size: "text-base", weight: "font-normal", lineHeight: "leading-normal" };
                onUpdate({ ...tokens, typography: { ...tokens.typography, scale: s } });
                setNewTypeName("");
              }
            }}
          />
          <button
            onClick={() => {
              if (newTypeName) {
                const s = { ...tokens.typography.scale };
                s[newTypeName] = { size: "text-base", weight: "font-normal", lineHeight: "leading-normal" };
                onUpdate({ ...tokens, typography: { ...tokens.typography, scale: s } });
                setNewTypeName("");
              }
            }}
            disabled={!newTypeName}
            className="flex items-center gap-1  bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            <Plus size={10} /> Add
          </button>
        </div>
      </div>

      {/* Spacing tokens */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Spacing Tokens
        </h3>
        <div className="space-y-1.5">
          {Object.entries(tokens.spacing).map(([name, value]) => (
            <div key={name} className="flex items-center gap-2  bg-zinc-800 px-2 py-1.5">
              <span className="w-16 shrink-0 text-[10px] font-medium text-zinc-300">{name}</span>
              <input
                value={value}
                onChange={(e) => onUpdate({ ...tokens, spacing: { ...tokens.spacing, [name]: e.target.value } })}
                className="flex-1  bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
              />
              <button
                onClick={() => {
                  const sp = { ...tokens.spacing };
                  delete sp[name];
                  onUpdate({ ...tokens, spacing: sp });
                }}
                className="shrink-0 text-zinc-600 hover:text-red-400"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newSpacingName}
            onChange={(e) => setNewSpacingName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="token-name"
            className=" bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSpacingName) {
                onUpdate({ ...tokens, spacing: { ...tokens.spacing, [newSpacingName]: "p-4" } });
                setNewSpacingName("");
              }
            }}
          />
          <button
            onClick={() => {
              if (newSpacingName) {
                onUpdate({ ...tokens, spacing: { ...tokens.spacing, [newSpacingName]: "p-4" } });
                setNewSpacingName("");
              }
            }}
            disabled={!newSpacingName}
            className="flex items-center gap-1  bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            <Plus size={10} /> Add
          </button>
        </div>
      </div>

      {/* Radii tokens */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Border Radius Tokens
        </h3>
        <div className="space-y-1.5">
          {Object.entries(tokens.radii).map(([name, value]) => (
            <div key={name} className="flex items-center gap-2  bg-zinc-800 px-2 py-1.5">
              <span className="w-16 shrink-0 text-[10px] font-medium text-zinc-300">{name}</span>
              <input
                value={value}
                onChange={(e) => onUpdate({ ...tokens, radii: { ...tokens.radii, [name]: e.target.value } })}
                className="flex-1  bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Shadow tokens */}
      <div>
        <h3 className="mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Shadow Tokens
        </h3>
        <div className="space-y-1.5">
          {Object.entries(tokens.shadows).map(([name, value]) => (
            <div key={name} className="flex items-center gap-2  bg-zinc-800 px-2 py-1.5">
              <span className="w-16 shrink-0 text-[10px] font-medium text-zinc-300">{name}</span>
              <input
                value={value}
                onChange={(e) => onUpdate({ ...tokens, shadows: { ...tokens.shadows, [name]: e.target.value } })}
                className="flex-1  bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 outline-none font-mono focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
