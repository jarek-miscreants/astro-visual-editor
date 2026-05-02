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
    <div className="tve-prop-section tve-prop-section--compact">
      <div className="tve-prop-section__header">
        <Sparkles size={10} className="tve-prop-section__header-icon--amber" />
        Tokens
      </div>

      {matchedTypoToken && (
        <div className="tve-prop-token-banner">
          Matches <span className="tve-prop-token-banner__name">{matchedTypoToken[0]}</span> token
        </div>
      )}

      {typographyMatches.length > 0 && (
        <div className="tve-prop-token-group">
          <div className="tve-prop-token-group__title">Typography</div>
          {typographyMatches.map((t) => {
            const isActive = matchedTypoToken?.[0] === t.name;
            return (
              <button
                key={t.name}
                onClick={() => applyTypographyToken(t)}
                className="tve-prop-token"
                data-active={isActive || undefined}
              >
                <span className="tve-prop-token__name">{t.name}</span>
                <span className="tve-prop-token__detail">{t.size} {t.weight} {t.lineHeight}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="tve-prop-token-group">
        <div className="tve-prop-token-group__title">Colors</div>
        <div className="tve-prop-token-colors">
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
                className="tve-prop-token-color"
                title={`Left click: bg-${value} | Right click: text-${value}`}
              >
                <span
                  className="tve-prop-swatch tve-prop-swatch--xs"
                  style={{ backgroundColor: hex || "#888" }}
                />
                {name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
