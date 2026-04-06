import { Sparkles } from "lucide-react";
import { useThemeStore, type DesignTokens } from "../../store/theme-store";
import { parseClasses, joinClasses } from "../../lib/class-utils";

interface TokenSuggestionsProps {
  tagName: string;
  classes: string;
  onClassesChange: (classes: string) => void;
}

/** Map HTML tags to likely token names */
const TAG_TO_TOKEN: Record<string, string[]> = {
  h1: ["h1"],
  h2: ["h2"],
  h3: ["h3"],
  h4: ["h4"],
  h5: ["h5"],
  h6: ["h6"],
  p: ["body", "small", "caption"],
  span: ["body", "small", "caption"],
  a: ["body", "small"],
  button: ["body", "small"],
  li: ["body", "small"],
  blockquote: ["body"],
};

export function TokenSuggestions({ tagName, classes, onClassesChange }: TokenSuggestionsProps) {
  const tokens = useThemeStore((s) => s.tokens);
  if (!tokens) return null;

  const tag = tagName.toLowerCase();
  const suggestedNames = TAG_TO_TOKEN[tag];
  const currentClasses = parseClasses(classes);

  // Find matching typography tokens
  const typographyMatches = suggestedNames
    ? suggestedNames
        .filter((name) => tokens.typography.scale[name])
        .map((name) => ({ name, ...tokens.typography.scale[name] }))
    : [];

  // Find matching color tokens
  const colorTokenEntries = Object.entries(tokens.colors);

  // Check if current classes already match a token
  const matchedTypoToken = Object.entries(tokens.typography.scale).find(([, style]) => {
    return currentClasses.includes(style.size) &&
           currentClasses.includes(style.weight);
  });

  function applyTypographyToken(style: { size: string; weight: string; lineHeight: string }) {
    // Remove existing size/weight/leading classes, add token's classes
    const sizeClasses = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl",
      "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];
    const weightClasses = ["font-thin", "font-extralight", "font-light", "font-normal",
      "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black"];
    const leadingClasses = ["leading-none", "leading-tight", "leading-snug",
      "leading-normal", "leading-relaxed", "leading-loose"];

    const removeSet = new Set([...sizeClasses, ...weightClasses, ...leadingClasses]);
    const kept = currentClasses.filter((c) => !removeSet.has(c));
    const newClasses = [...kept, style.size, style.weight, style.lineHeight].filter(Boolean);
    onClassesChange(joinClasses(newClasses));
  }

  function applyColorToken(prefix: string, tokenValue: string) {
    // tokenValue is like "blue-600" — we need to add "bg-blue-600" or "text-blue-600"
    const newClass = `${prefix}-${tokenValue}`;
    // Remove existing color class for this prefix then add new one
    const colorPattern = new RegExp(`^${prefix}-(\\w+)(-\\d+)?$`);
    const kept = currentClasses.filter((c) => !colorPattern.test(c) && c !== `${prefix}-white` && c !== `${prefix}-black`);
    onClassesChange(joinClasses([...kept, newClass]));
  }

  if (typographyMatches.length === 0 && colorTokenEntries.length === 0) return null;

  return (
    <div className="border-b border-zinc-800 px-3 py-2">
      <div className="flex items-center gap-1 mb-1.5 text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider">
        <Sparkles size={10} />
        Tokens
      </div>

      {/* Current match indicator */}
      {matchedTypoToken && (
        <div className="mb-1.5 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] text-amber-300">
          Matches <span className="font-mono font-bold">{matchedTypoToken[0]}</span> token
        </div>
      )}

      {/* Typography token suggestions */}
      {typographyMatches.length > 0 && (
        <div className="space-y-1 mb-2">
          <div className="text-[9px] text-zinc-500">Typography</div>
          {typographyMatches.map((t) => {
            const isActive = matchedTypoToken?.[0] === t.name;
            return (
              <button
                key={t.name}
                onClick={() => applyTypographyToken(t)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] transition-colors ${
                  isActive
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <span className="font-medium w-8">{t.name}</span>
                <span className="font-mono text-zinc-500">{t.size} {t.weight} {t.lineHeight}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Color token quick-apply */}
      <div className="space-y-1">
        <div className="text-[9px] text-zinc-500">Colors</div>
        <div className="flex flex-wrap gap-1">
          {colorTokenEntries.slice(0, 8).map(([name, value]) => {
            const resolveHex = useThemeStore.getState().resolveColorHex;
            const hex = resolveHex(value);
            return (
              <button
                key={name}
                onClick={() => applyColorToken("bg", value)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  applyColorToken("text", value);
                }}
                className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-700"
                title={`Left click: bg-${value} | Right click: text-${value}`}
              >
                <span className="h-2.5 w-2.5 rounded-sm border border-zinc-600" style={{ backgroundColor: hex || "#888" }} />
                {name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
