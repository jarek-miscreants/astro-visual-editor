import { useState } from "react";
import { parseClasses, joinClasses } from "../../lib/class-utils";

interface ColorControlsProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

const COLORS: Record<string, Record<string, string>> = {
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

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const COLOR_NAMES = Object.keys(COLORS);

type ColorProperty = "text" | "bg" | "border";

/** Check if a class is a color class for a given prefix (exact match, not substring) */
function isColorClassForPrefix(cls: string, prefix: ColorProperty): boolean {
  // Match: prefix-colorName-shade (e.g., text-blue-600, bg-red-100)
  // Match: prefix-white, prefix-black, prefix-transparent
  const colorPattern = new RegExp(
    `^${prefix}-(${COLOR_NAMES.join("|")})-(${SHADES.join("|")})$`
  );
  if (colorPattern.test(cls)) return true;
  if (cls === `${prefix}-white` || cls === `${prefix}-black` || cls === `${prefix}-transparent`) return true;
  return false;
}

/** Remove all color classes for a specific prefix, keeping everything else intact */
function removeColorClasses(classes: string, prefix: ColorProperty): string {
  const list = parseClasses(classes);
  return joinClasses(list.filter((cls) => !isColorClassForPrefix(cls, prefix)));
}

export function ColorControls({ classes, onClassesChange }: ColorControlsProps) {
  return (
    <div className="space-y-3">
      <ColorPicker label="Text" prefix="text" classes={classes} onClassesChange={onClassesChange} />
      <ColorPicker label="Background" prefix="bg" classes={classes} onClassesChange={onClassesChange} />
      <ColorPicker label="Border" prefix="border" classes={classes} onClassesChange={onClassesChange} />
    </div>
  );
}

function ColorPicker({
  label,
  prefix,
  classes,
  onClassesChange,
}: {
  label: string;
  prefix: ColorProperty;
  classes: string;
  onClassesChange: (classes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Find current color for this prefix
  const classList = parseClasses(classes);
  const currentColor = classList.find((cls) => isColorClassForPrefix(cls, prefix)) || null;
  const currentHex = currentColor ? getHexForClass(prefix, currentColor) : null;

  function setColor(newColorClass: string) {
    const cleaned = removeColorClasses(classes, prefix);
    const result = cleaned ? `${cleaned} ${newColorClass}` : newColorClass;
    onClassesChange(result);
  }

  function clearColor() {
    onClassesChange(removeColorClasses(classes, prefix));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-500">{label}</span>
        <div className="flex items-center gap-1">
          {currentHex && (
            <span
              className="h-4 w-4  border border-zinc-600"
              style={{ backgroundColor: currentHex }}
            />
          )}
          <span className="font-mono text-[10px] text-zinc-400">
            {currentColor || "none"}
          </span>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full  bg-zinc-800 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 text-left"
      >
        {expanded ? "Close palette" : "Choose color..."}
      </button>

      {expanded && (
        <div className="mt-1.5  border border-zinc-700 bg-zinc-800 p-2">
          {/* Special values */}
          <div className="flex gap-1 mb-2">
            <button
              onClick={clearColor}
              className=" px-1.5 py-0.5 text-[9px] bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
            >
              none
            </button>
            <button
              onClick={() => setColor(`${prefix}-white`)}
              className=" px-1.5 py-0.5 text-[9px] bg-white text-zinc-900 border border-zinc-600"
            >
              white
            </button>
            <button
              onClick={() => setColor(`${prefix}-black`)}
              className=" px-1.5 py-0.5 text-[9px] bg-black text-white border border-zinc-600"
            >
              black
            </button>
          </div>

          {/* Color grid */}
          <div className="space-y-0.5">
            {COLOR_NAMES.map((colorName) => (
              <div key={colorName} className="flex gap-0.5" title={colorName}>
                {SHADES.map((shade) => {
                  const hex = (COLORS[colorName] as Record<string, string>)[shade];
                  const cls = `${prefix}-${colorName}-${shade}`;
                  const isActive = currentColor === cls;
                  return (
                    <button
                      key={shade}
                      onClick={() => setColor(cls)}
                      className={`h-4 w-4  transition-transform ${
                        isActive ? "ring-2 ring-white scale-125 z-10" : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: hex }}
                      title={`${colorName}-${shade}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getHexForClass(prefix: string, className: string): string | null {
  if (className === `${prefix}-white`) return "#ffffff";
  if (className === `${prefix}-black`) return "#000000";
  if (className === `${prefix}-transparent`) return "transparent";

  const match = className.match(new RegExp(`^${prefix}-(\\w+)-(\\d+)$`));
  if (!match) return null;

  const [, colorName, shade] = match;
  const colorMap = COLORS[colorName];
  if (!colorMap) return null;

  return (colorMap as Record<string, string>)[shade] || null;
}
