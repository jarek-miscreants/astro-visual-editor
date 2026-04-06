export interface TailwindClassInfo {
  name: string;
  category: string;
  color?: string;
}

/**
 * Core Tailwind classes database. This is a subset for Phase 1.
 * Phase 2 will expand this with the full Tailwind class catalog + project theme.
 */
export const TAILWIND_CLASSES: TailwindClassInfo[] = [
  // Display
  ...["block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents", "table"].map(
    (name) => ({ name, category: "display" })
  ),

  // Flex
  ...["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse", "flex-wrap", "flex-nowrap", "flex-1", "flex-auto", "flex-initial", "flex-none"].map(
    (name) => ({ name, category: "flexbox" })
  ),
  ...["justify-start", "justify-end", "justify-center", "justify-between", "justify-around", "justify-evenly"].map(
    (name) => ({ name, category: "flexbox" })
  ),
  ...["items-start", "items-end", "items-center", "items-baseline", "items-stretch"].map(
    (name) => ({ name, category: "flexbox" })
  ),
  ...["gap-0", "gap-1", "gap-2", "gap-3", "gap-4", "gap-5", "gap-6", "gap-8", "gap-10", "gap-12"].map(
    (name) => ({ name, category: "flexbox" })
  ),

  // Grid
  ...["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-6", "grid-cols-12"].map(
    (name) => ({ name, category: "grid" })
  ),
  ...["col-span-1", "col-span-2", "col-span-3", "col-span-4", "col-span-6", "col-span-full"].map(
    (name) => ({ name, category: "grid" })
  ),

  // Spacing - Padding
  ...[0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24].flatMap((n) => [
    { name: `p-${n}`, category: "padding" },
    { name: `px-${n}`, category: "padding" },
    { name: `py-${n}`, category: "padding" },
    { name: `pt-${n}`, category: "padding" },
    { name: `pr-${n}`, category: "padding" },
    { name: `pb-${n}`, category: "padding" },
    { name: `pl-${n}`, category: "padding" },
  ]),

  // Spacing - Margin
  ...[0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, "auto"].flatMap((n) => [
    { name: `m-${n}`, category: "margin" },
    { name: `mx-${n}`, category: "margin" },
    { name: `my-${n}`, category: "margin" },
    { name: `mt-${n}`, category: "margin" },
    { name: `mr-${n}`, category: "margin" },
    { name: `mb-${n}`, category: "margin" },
    { name: `ml-${n}`, category: "margin" },
  ]),

  // Width
  ...["w-auto", "w-full", "w-screen", "w-min", "w-max", "w-fit", "w-1/2", "w-1/3", "w-2/3", "w-1/4", "w-3/4"].map(
    (name) => ({ name, category: "sizing" })
  ),
  ...[0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 96].map(
    (n) => ({ name: `w-${n}`, category: "sizing" })
  ),

  // Height
  ...["h-auto", "h-full", "h-screen", "h-min", "h-max", "h-fit", "h-1/2", "h-1/3", "h-2/3"].map(
    (name) => ({ name, category: "sizing" })
  ),
  ...[0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 96].map(
    (n) => ({ name: `h-${n}`, category: "sizing" })
  ),

  // Max width
  ...["max-w-none", "max-w-xs", "max-w-sm", "max-w-md", "max-w-lg", "max-w-xl", "max-w-2xl", "max-w-3xl", "max-w-4xl", "max-w-5xl", "max-w-6xl", "max-w-7xl", "max-w-full", "max-w-screen-sm", "max-w-screen-md", "max-w-screen-lg", "max-w-screen-xl", "max-w-prose"].map(
    (name) => ({ name, category: "sizing" })
  ),

  // Typography
  ...["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"].map(
    (name) => ({ name, category: "typography" })
  ),
  ...["font-thin", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black"].map(
    (name) => ({ name, category: "typography" })
  ),
  ...["text-left", "text-center", "text-right", "text-justify"].map(
    (name) => ({ name, category: "typography" })
  ),
  ...["leading-none", "leading-tight", "leading-snug", "leading-normal", "leading-relaxed", "leading-loose"].map(
    (name) => ({ name, category: "typography" })
  ),
  ...["tracking-tighter", "tracking-tight", "tracking-normal", "tracking-wide", "tracking-wider", "tracking-widest"].map(
    (name) => ({ name, category: "typography" })
  ),
  ...["italic", "not-italic", "underline", "no-underline", "line-through", "uppercase", "lowercase", "capitalize", "normal-case", "truncate"].map(
    (name) => ({ name, category: "typography" })
  ),

  // Colors - Text
  ...generateColorClasses("text", "text-color"),
  // Colors - Background
  ...generateColorClasses("bg", "background"),
  // Colors - Border
  ...generateColorClasses("border", "border-color"),

  // Borders
  ...["border", "border-0", "border-2", "border-4", "border-8", "border-t", "border-r", "border-b", "border-l"].map(
    (name) => ({ name, category: "borders" })
  ),
  ...["rounded-none", "rounded-sm", "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full"].map(
    (name) => ({ name, category: "borders" })
  ),

  // Effects
  ...["shadow-sm", "shadow", "shadow-md", "shadow-lg", "shadow-xl", "shadow-2xl", "shadow-none"].map(
    (name) => ({ name, category: "effects" })
  ),
  ...["opacity-0", "opacity-5", "opacity-10", "opacity-20", "opacity-25", "opacity-30", "opacity-40", "opacity-50", "opacity-60", "opacity-70", "opacity-75", "opacity-80", "opacity-90", "opacity-95", "opacity-100"].map(
    (name) => ({ name, category: "effects" })
  ),

  // Position
  ...["static", "relative", "absolute", "fixed", "sticky"].map(
    (name) => ({ name, category: "position" })
  ),
  ...["inset-0", "top-0", "right-0", "bottom-0", "left-0", "inset-auto", "z-0", "z-10", "z-20", "z-30", "z-40", "z-50", "z-auto"].map(
    (name) => ({ name, category: "position" })
  ),

  // Overflow
  ...["overflow-auto", "overflow-hidden", "overflow-visible", "overflow-scroll", "overflow-x-auto", "overflow-y-auto", "overflow-x-hidden", "overflow-y-hidden"].map(
    (name) => ({ name, category: "layout" })
  ),

  // Transitions
  ...["transition", "transition-all", "transition-colors", "transition-opacity", "transition-shadow", "transition-transform", "duration-75", "duration-100", "duration-150", "duration-200", "duration-300", "duration-500", "duration-700", "duration-1000", "ease-linear", "ease-in", "ease-out", "ease-in-out"].map(
    (name) => ({ name, category: "transitions" })
  ),

  // Transforms
  ...["scale-0", "scale-50", "scale-75", "scale-90", "scale-95", "scale-100", "scale-105", "scale-110", "scale-125", "scale-150", "rotate-0", "rotate-1", "rotate-2", "rotate-3", "rotate-6", "rotate-12", "rotate-45", "rotate-90", "rotate-180"].map(
    (name) => ({ name, category: "transforms" })
  ),

  // Cursor
  ...["cursor-pointer", "cursor-default", "cursor-wait", "cursor-text", "cursor-move", "cursor-not-allowed", "cursor-grab"].map(
    (name) => ({ name, category: "interactivity" })
  ),

  // User select
  ...["select-none", "select-text", "select-all", "select-auto"].map(
    (name) => ({ name, category: "interactivity" })
  ),
];

function generateColorClasses(
  prefix: string,
  category: string
): TailwindClassInfo[] {
  const colors: Record<string, Record<string, string>> = {
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

  const result: TailwindClassInfo[] = [
    { name: `${prefix}-transparent`, category, color: "transparent" },
    { name: `${prefix}-black`, category, color: "#000000" },
    { name: `${prefix}-white`, category, color: "#ffffff" },
  ];

  for (const [colorName, shades] of Object.entries(colors)) {
    for (const [shade, hex] of Object.entries(shades)) {
      result.push({
        name: `${prefix}-${colorName}-${shade}`,
        category,
        color: hex,
      });
    }
  }

  return result;
}

/** Simple fuzzy search for Tailwind classes */
export function searchClasses(query: string): TailwindClassInfo[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Exact prefix match first
  const prefixMatches = TAILWIND_CLASSES.filter((c) =>
    c.name.toLowerCase().startsWith(q)
  );

  // Then contains match
  const containsMatches = TAILWIND_CLASSES.filter(
    (c) =>
      !c.name.toLowerCase().startsWith(q) &&
      c.name.toLowerCase().includes(q)
  );

  // Then fuzzy: split query into parts and check all parts match
  const parts = q.split(/\s+/);
  const fuzzyMatches = TAILWIND_CLASSES.filter((c) => {
    const name = c.name.toLowerCase();
    const cat = c.category.toLowerCase();
    return (
      !name.startsWith(q) &&
      !name.includes(q) &&
      parts.every((p) => name.includes(p) || cat.includes(p))
    );
  });

  return [...prefixMatches, ...containsMatches, ...fuzzyMatches];
}
