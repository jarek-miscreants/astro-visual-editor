import { replaceClassFromSet, replaceClassByPrefix, getClassByPrefix, hasClass } from "../../lib/class-utils";
import { useThemeStore } from "../../store/theme-store";

interface TypographyControlsProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

const FONT_SIZES = [
  { cls: "text-xs", label: "xs", px: "12px" },
  { cls: "text-sm", label: "sm", px: "14px" },
  { cls: "text-base", label: "base", px: "16px" },
  { cls: "text-lg", label: "lg", px: "18px" },
  { cls: "text-xl", label: "xl", px: "20px" },
  { cls: "text-2xl", label: "2xl", px: "24px" },
  { cls: "text-3xl", label: "3xl", px: "30px" },
  { cls: "text-4xl", label: "4xl", px: "36px" },
  { cls: "text-5xl", label: "5xl", px: "48px" },
  { cls: "text-6xl", label: "6xl", px: "60px" },
  { cls: "text-7xl", label: "7xl", px: "72px" },
  { cls: "text-8xl", label: "8xl", px: "96px" },
  { cls: "text-9xl", label: "9xl", px: "128px" },
];

const FONT_WEIGHTS = [
  { cls: "font-thin", label: "Thin", val: "100" },
  { cls: "font-extralight", label: "ExtraLight", val: "200" },
  { cls: "font-light", label: "Light", val: "300" },
  { cls: "font-normal", label: "Normal", val: "400" },
  { cls: "font-medium", label: "Medium", val: "500" },
  { cls: "font-semibold", label: "SemiBold", val: "600" },
  { cls: "font-bold", label: "Bold", val: "700" },
  { cls: "font-extrabold", label: "ExtraBold", val: "800" },
  { cls: "font-black", label: "Black", val: "900" },
];

const TEXT_ALIGN = ["text-left", "text-center", "text-right", "text-justify"];
const ALIGN_LABELS = ["left", "center", "right", "justify"];

const LINE_HEIGHT = [
  "leading-none", "leading-tight", "leading-snug",
  "leading-normal", "leading-relaxed", "leading-loose",
];

const LETTER_SPACING = [
  "tracking-tighter", "tracking-tight", "tracking-normal",
  "tracking-wide", "tracking-wider", "tracking-widest",
];

const TEXT_TRANSFORM = ["uppercase", "lowercase", "capitalize", "normal-case"];
const TEXT_DECORATION = ["underline", "no-underline", "line-through"];

// Default font families always available
const DEFAULT_FONT_FAMILIES = [
  { cls: "font-sans", label: "Sans Serif" },
  { cls: "font-serif", label: "Serif" },
  { cls: "font-mono", label: "Monospace" },
];

export function TypographyControls({ classes, onClassesChange }: TypographyControlsProps) {
  const allSizes = FONT_SIZES.map((s) => s.cls);
  const allWeights = FONT_WEIGHTS.map((w) => w.cls);
  const currentSize = allSizes.find((s) => hasClass(classes, s)) || "";
  const currentWeight = allWeights.find((w) => hasClass(classes, w)) || "";
  const currentAlign = TEXT_ALIGN.find((a) => hasClass(classes, a)) || "";

  // Read custom font families from theme config
  const extend = useThemeStore((s) => s.extend);
  const customFonts = extend?.fontFamily
    ? Object.keys(extend.fontFamily).map((name) => ({
        cls: `font-${name}`,
        label: name.charAt(0).toUpperCase() + name.slice(1),
      }))
    : [];

  const allFontFamilies = [...DEFAULT_FONT_FAMILIES, ...customFonts];
  const allFontClasses = allFontFamilies.map((f) => f.cls);
  const currentFont = allFontClasses.find((f) => hasClass(classes, f)) || "";

  return (
    <div className="space-y-3">
      {/* Font Family */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Font Family</div>
        <select
          value={currentFont}
          onChange={(e) => onClassesChange(replaceClassFromSet(classes, allFontClasses, e.target.value))}
          className="h-7 w-full  border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 hover:border-zinc-700 transition-colors cursor-pointer"
        >
          <option value="">default</option>
          {allFontFamilies.map((f) => (
            <option key={f.cls} value={f.cls}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Size</div>
        <select
          value={currentSize}
          onChange={(e) => onClassesChange(replaceClassFromSet(classes, allSizes, e.target.value))}
          className="h-7 w-full  border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 hover:border-zinc-700 transition-colors cursor-pointer"
        >
          <option value="">default</option>
          {FONT_SIZES.map((s) => (
            <option key={s.cls} value={s.cls}>
              {s.label} ({s.px})
            </option>
          ))}
        </select>
      </div>

      {/* Font Weight */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Weight</div>
        <select
          value={currentWeight}
          onChange={(e) => onClassesChange(replaceClassFromSet(classes, allWeights, e.target.value))}
          className="h-7 w-full  border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 hover:border-zinc-700 transition-colors cursor-pointer"
        >
          <option value="">default</option>
          {FONT_WEIGHTS.map((w) => (
            <option key={w.cls} value={w.cls}>
              {w.label} ({w.val})
            </option>
          ))}
        </select>
      </div>

      {/* Text Align */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Align</div>
        <div className="flex gap-0.5">
          {TEXT_ALIGN.map((a, i) => (
            <button
              key={a}
              onClick={() => onClassesChange(replaceClassFromSet(classes, TEXT_ALIGN, a === currentAlign ? "" : a))}
              className={`flex-1  py-0.5 text-[10px] transition-colors ${
                a === currentAlign
                  ? "bg-blue-600/30 text-blue-300 border border-blue-500/40"
                  : "bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700"
              }`}
            >
              {ALIGN_LABELS[i]}
            </button>
          ))}
        </div>
      </div>

      {/* Line Height */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Line Height</div>
        <select
          value={LINE_HEIGHT.find((l) => hasClass(classes, l)) || ""}
          onChange={(e) => onClassesChange(replaceClassFromSet(classes, LINE_HEIGHT, e.target.value))}
          className="h-7 w-full  border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 hover:border-zinc-700 transition-colors cursor-pointer"
        >
          <option value="">default</option>
          {LINE_HEIGHT.map((l) => (
            <option key={l} value={l}>{l.replace("leading-", "")}</option>
          ))}
        </select>
      </div>

      {/* Letter Spacing */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Letter Spacing</div>
        <select
          value={LETTER_SPACING.find((l) => hasClass(classes, l)) || ""}
          onChange={(e) => onClassesChange(replaceClassFromSet(classes, LETTER_SPACING, e.target.value))}
          className="h-7 w-full  border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 hover:border-zinc-700 transition-colors cursor-pointer"
        >
          <option value="">default</option>
          {LETTER_SPACING.map((l) => (
            <option key={l} value={l}>{l.replace("tracking-", "")}</option>
          ))}
        </select>
      </div>

      {/* Transform & Decoration */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium text-zinc-400">Style</div>
        <div className="flex flex-wrap gap-0.5">
          {[...TEXT_TRANSFORM, ...TEXT_DECORATION].map((cls) => (
            <button
              key={cls}
              onClick={() => {
                const set = TEXT_TRANSFORM.includes(cls) ? TEXT_TRANSFORM : TEXT_DECORATION;
                const isActive = hasClass(classes, cls);
                onClassesChange(replaceClassFromSet(classes, set, isActive ? "" : cls));
              }}
              className={` px-1.5 py-0.5 text-[10px] transition-colors ${
                hasClass(classes, cls)
                  ? "bg-blue-600/30 text-blue-300 border border-blue-500/40"
                  : "bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700"
              }`}
            >
              {cls}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
