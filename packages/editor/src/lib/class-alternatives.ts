/**
 * Given a Tailwind class, returns all related alternatives.
 * E.g., "mt-4" → ["mt-0", "mt-1", "mt-2", ..., "mt-auto"]
 * E.g., "bg-blue-600" → ["bg-blue-50", "bg-blue-100", ..., "bg-blue-950"]
 * E.g., "text-xl" → ["text-xs", "text-sm", ..., "text-9xl"]
 * E.g., "font-bold" → ["font-thin", "font-light", ..., "font-black"]
 */

interface Alternative {
  value: string;
  label?: string;
  color?: string;
}

const SPACING = ["0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96"];
const SPACING_PX: Record<string, string> = {
  "0": "0", "px": "1px", "0.5": "2px", "1": "4px", "1.5": "6px", "2": "8px",
  "2.5": "10px", "3": "12px", "3.5": "14px", "4": "16px", "5": "20px", "6": "24px",
  "7": "28px", "8": "32px", "9": "36px", "10": "40px", "11": "44px", "12": "48px",
  "14": "56px", "16": "64px", "20": "80px", "24": "96px", "28": "112px", "32": "128px",
  "36": "144px", "40": "160px", "44": "176px", "48": "192px", "52": "208px",
  "56": "224px", "60": "240px", "64": "256px", "72": "288px", "80": "320px", "96": "384px",
};

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
const COLOR_NAMES = Object.keys(COLORS);
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

// Predefined class groups
const GROUPS: Record<string, Alternative[]> = {
  // Font size
  "text-size": [
    { value: "text-xs", label: "12px" }, { value: "text-sm", label: "14px" },
    { value: "text-base", label: "16px" }, { value: "text-lg", label: "18px" },
    { value: "text-xl", label: "20px" }, { value: "text-2xl", label: "24px" },
    { value: "text-3xl", label: "30px" }, { value: "text-4xl", label: "36px" },
    { value: "text-5xl", label: "48px" }, { value: "text-6xl", label: "60px" },
    { value: "text-7xl", label: "72px" }, { value: "text-8xl", label: "96px" },
    { value: "text-9xl", label: "128px" },
  ],
  // Font weight
  "font-weight": [
    { value: "font-thin", label: "100" }, { value: "font-extralight", label: "200" },
    { value: "font-light", label: "300" }, { value: "font-normal", label: "400" },
    { value: "font-medium", label: "500" }, { value: "font-semibold", label: "600" },
    { value: "font-bold", label: "700" }, { value: "font-extrabold", label: "800" },
    { value: "font-black", label: "900" },
  ],
  // Text align
  "text-align": [
    { value: "text-left" }, { value: "text-center" },
    { value: "text-right" }, { value: "text-justify" },
  ],
  // Display
  "display": [
    { value: "block" }, { value: "inline-block" }, { value: "inline" },
    { value: "flex" }, { value: "inline-flex" }, { value: "grid" },
    { value: "inline-grid" }, { value: "hidden" }, { value: "contents" },
  ],
  // Position
  "position": [
    { value: "static" }, { value: "relative" }, { value: "absolute" },
    { value: "fixed" }, { value: "sticky" },
  ],
  // Flex direction
  "flex-dir": [
    { value: "flex-row" }, { value: "flex-col" },
    { value: "flex-row-reverse" }, { value: "flex-col-reverse" },
  ],
  // Justify
  "justify": [
    { value: "justify-start" }, { value: "justify-end" }, { value: "justify-center" },
    { value: "justify-between" }, { value: "justify-around" }, { value: "justify-evenly" },
  ],
  // Align items
  "items": [
    { value: "items-start" }, { value: "items-end" }, { value: "items-center" },
    { value: "items-baseline" }, { value: "items-stretch" },
  ],
  // Border radius
  "rounded": [
    { value: "rounded-none", label: "0" }, { value: "rounded-sm", label: "2px" },
    { value: "rounded", label: "4px" }, { value: "rounded-md", label: "6px" },
    { value: "rounded-lg", label: "8px" }, { value: "rounded-xl", label: "12px" },
    { value: "rounded-2xl", label: "16px" }, { value: "rounded-3xl", label: "24px" },
    { value: "rounded-full", label: "9999px" },
  ],
  // Shadow
  "shadow": [
    { value: "shadow-none" }, { value: "shadow-sm" }, { value: "shadow" },
    { value: "shadow-md" }, { value: "shadow-lg" }, { value: "shadow-xl" },
    { value: "shadow-2xl" },
  ],
  // Leading
  "leading": [
    { value: "leading-none", label: "1" }, { value: "leading-tight", label: "1.25" },
    { value: "leading-snug", label: "1.375" }, { value: "leading-normal", label: "1.5" },
    { value: "leading-relaxed", label: "1.625" }, { value: "leading-loose", label: "2" },
  ],
  // Tracking
  "tracking": [
    { value: "tracking-tighter" }, { value: "tracking-tight" },
    { value: "tracking-normal" }, { value: "tracking-wide" },
    { value: "tracking-wider" }, { value: "tracking-widest" },
  ],
  // Opacity
  "opacity": [
    { value: "opacity-0" }, { value: "opacity-5" }, { value: "opacity-10" },
    { value: "opacity-20" }, { value: "opacity-25" }, { value: "opacity-30" },
    { value: "opacity-40" }, { value: "opacity-50" }, { value: "opacity-60" },
    { value: "opacity-70" }, { value: "opacity-75" }, { value: "opacity-80" },
    { value: "opacity-90" }, { value: "opacity-95" }, { value: "opacity-100" },
  ],
};

// Lookup: class name → group key
const CLASS_TO_GROUP = new Map<string, string>();
for (const [groupKey, alts] of Object.entries(GROUPS)) {
  for (const alt of alts) {
    CLASS_TO_GROUP.set(alt.value, groupKey);
  }
}

/** Spacing prefixes that use the standard spacing scale */
const SPACING_PREFIXES = [
  "p", "px", "py", "pt", "pr", "pb", "pl",
  "m", "mx", "my", "mt", "mr", "mb", "ml",
  "gap", "gap-x", "gap-y",
  "w", "h",
  "min-w", "min-h", "max-w", "max-h",
  "top", "right", "bottom", "left",
  "inset", "inset-x", "inset-y",
  "space-x", "space-y",
];

/** Color prefixes */
const COLOR_PREFIXES = ["text", "bg", "border", "ring", "from", "to", "via", "accent", "outline", "fill", "stroke"];

const RESPONSIVE_PREFIXES = ["sm", "md", "lg", "xl", "2xl"];
const STATE_PREFIXES = ["hover", "focus", "active", "disabled", "first", "last", "odd", "even", "dark"];

/**
 * Strip responsive/state prefix from a class.
 * E.g., "md:grid-cols-3" → { prefix: "md:", base: "grid-cols-3" }
 */
function stripPrefix(className: string): { prefix: string; base: string } {
  const match = className.match(/^([a-z0-9]+):(.+)$/);
  if (match) {
    const [, pfx, base] = match;
    if ([...RESPONSIVE_PREFIXES, ...STATE_PREFIXES].includes(pfx)) {
      return { prefix: `${pfx}:`, base };
    }
  }
  return { prefix: "", base: className };
}

export function getAlternatives(className: string): Alternative[] {
  // Strip responsive/state prefix, get alternatives for base, re-add prefix
  const { prefix, base } = stripPrefix(className);
  if (prefix) {
    const baseAlts = getBaseAlternatives(base);
    if (baseAlts.length > 1) {
      return baseAlts.map((alt) => ({
        ...alt,
        value: `${prefix}${alt.value}`,
      }));
    }
  }
  return getBaseAlternatives(className);
}

function getBaseAlternatives(className: string): Alternative[] {
  // 1. Check predefined groups
  const groupKey = CLASS_TO_GROUP.get(className);
  if (groupKey) {
    return GROUPS[groupKey];
  }

  // 2. Check spacing pattern: prefix-{value}
  for (const prefix of SPACING_PREFIXES) {
    const regex = new RegExp(`^${prefix.replace("-", "\\-")}-(\\S+)$`);
    const match = className.match(regex);
    if (match) {
      const values = prefix.startsWith("m") || prefix === "inset" || prefix.startsWith("inset-") || prefix.startsWith("space-")
        ? [...SPACING, "auto"]
        : SPACING;
      return values.map((v) => ({
        value: `${prefix}-${v}`,
        label: SPACING_PX[v] || v,
      }));
    }
  }

  // 3. Check color pattern: prefix-color-shade
  for (const prefix of COLOR_PREFIXES) {
    // Match: prefix-colorName-shade
    const colorMatch = className.match(new RegExp(`^${prefix}-(${COLOR_NAMES.join("|")})-(\\d+)$`));
    if (colorMatch) {
      const [, colorName] = colorMatch;
      const colorMap = COLORS[colorName];
      if (colorMap) {
        return SHADES.map((shade) => ({
          value: `${prefix}-${colorName}-${shade}`,
          label: shade,
          color: colorMap[shade],
        }));
      }
    }

    // Match: prefix-colorName (no shade, like text-white)
    if (className === `${prefix}-white` || className === `${prefix}-black` || className === `${prefix}-transparent`) {
      return [
        { value: `${prefix}-transparent`, label: "transparent" },
        { value: `${prefix}-white`, color: "#ffffff" },
        { value: `${prefix}-black`, color: "#000000" },
      ];
    }
  }

  // 4. Check grid-cols pattern
  const gridColsMatch = className.match(/^grid-cols-(\d+)$/);
  if (gridColsMatch) {
    return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((n) => ({
      value: `grid-cols-${n}`,
      label: `${n} cols`,
    }));
  }

  // 5. Check col-span pattern
  const colSpanMatch = className.match(/^col-span-(\d+|full)$/);
  if (colSpanMatch) {
    return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "full"].map((n) => ({
      value: `col-span-${n}`,
    }));
  }

  // 6. Check z-index
  const zMatch = className.match(/^z-(\d+|auto)$/);
  if (zMatch) {
    return ["auto", "0", "10", "20", "30", "40", "50"].map((v) => ({
      value: `z-${v}`,
    }));
  }

  // No alternatives found — return just this class (chip won't have dropdown)
  return [{ value: className }];
}
