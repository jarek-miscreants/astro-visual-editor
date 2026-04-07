import { replaceClassFromSet, replaceClassByPrefix, getClassByPrefix, hasClass, extractValue } from "../../lib/class-utils";

interface LayoutControlsProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

const DISPLAY_OPTIONS = ["block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "hidden", "contents"];
const POSITION_OPTIONS = ["static", "relative", "absolute", "fixed", "sticky"];
const FLEX_DIRECTION = ["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse"];
const JUSTIFY = ["justify-start", "justify-end", "justify-center", "justify-between", "justify-around", "justify-evenly"];
const ALIGN_ITEMS = ["items-start", "items-end", "items-center", "items-baseline", "items-stretch"];
const FLEX_WRAP = ["flex-wrap", "flex-nowrap", "flex-wrap-reverse"];
const GAP_VALUES = ["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16"];

export function LayoutControls({ classes, onClassesChange }: LayoutControlsProps) {
  const currentDisplay = DISPLAY_OPTIONS.find((d) => hasClass(classes, d)) || "";
  const currentPosition = POSITION_OPTIONS.find((p) => hasClass(classes, p)) || "";
  const isFlex = currentDisplay === "flex" || currentDisplay === "inline-flex";
  const isGrid = currentDisplay === "grid" || currentDisplay === "inline-grid";

  return (
    <div className="space-y-3">
      {/* Display */}
      <ControlGroup label="Display">
        <ButtonGroup
          options={DISPLAY_OPTIONS}
          value={currentDisplay}
          onChange={(v) => onClassesChange(replaceClassFromSet(classes, DISPLAY_OPTIONS, v))}
        />
      </ControlGroup>

      {/* Position */}
      <ControlGroup label="Position">
        <ButtonGroup
          options={POSITION_OPTIONS}
          value={currentPosition}
          onChange={(v) => onClassesChange(replaceClassFromSet(classes, POSITION_OPTIONS, v))}
        />
      </ControlGroup>

      {/* Flex controls */}
      {isFlex && (
        <>
          <ControlGroup label="Direction">
            <ButtonGroup
              options={FLEX_DIRECTION}
              labels={["→", "↓", "←", "↑"]}
              value={FLEX_DIRECTION.find((d) => hasClass(classes, d)) || ""}
              onChange={(v) => onClassesChange(replaceClassFromSet(classes, FLEX_DIRECTION, v))}
            />
          </ControlGroup>

          <ControlGroup label="Justify">
            <SelectControl
              options={JUSTIFY}
              value={JUSTIFY.find((j) => hasClass(classes, j)) || ""}
              onChange={(v) => onClassesChange(replaceClassFromSet(classes, JUSTIFY, v))}
            />
          </ControlGroup>

          <ControlGroup label="Align">
            <SelectControl
              options={ALIGN_ITEMS}
              value={ALIGN_ITEMS.find((a) => hasClass(classes, a)) || ""}
              onChange={(v) => onClassesChange(replaceClassFromSet(classes, ALIGN_ITEMS, v))}
            />
          </ControlGroup>

          <ControlGroup label="Wrap">
            <ButtonGroup
              options={FLEX_WRAP}
              labels={["wrap", "nowrap", "reverse"]}
              value={FLEX_WRAP.find((w) => hasClass(classes, w)) || ""}
              onChange={(v) => onClassesChange(replaceClassFromSet(classes, FLEX_WRAP, v))}
            />
          </ControlGroup>

          <ControlGroup label="Gap">
            <SelectControl
              options={GAP_VALUES.map((v) => `gap-${v}`)}
              value={getClassByPrefix(classes, "gap-") || ""}
              onChange={(v) => onClassesChange(replaceClassByPrefix(classes, "gap-", v))}
            />
          </ControlGroup>
        </>
      )}

      {/* Grid controls */}
      {isGrid && (
        <>
          <ControlGroup label="Columns">
            <SelectControl
              options={["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5", "grid-cols-6", "grid-cols-12"]}
              value={getClassByPrefix(classes, "grid-cols-") || ""}
              onChange={(v) => onClassesChange(replaceClassByPrefix(classes, "grid-cols-", v))}
            />
          </ControlGroup>

          <ControlGroup label="Gap">
            <SelectControl
              options={GAP_VALUES.map((v) => `gap-${v}`)}
              value={getClassByPrefix(classes, "gap-") || ""}
              onChange={(v) => onClassesChange(replaceClassByPrefix(classes, "gap-", v))}
            />
          </ControlGroup>
        </>
      )}
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium text-zinc-400">{label}</div>
      {children}
    </div>
  );
}

function ButtonGroup({
  options,
  labels,
  value,
  onChange,
}: {
  options: string[];
  labels?: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {options.map((opt, i) => {
        const label = labels?.[i] || opt.replace(/^(flex-|justify-|items-|grid-|inline-)/, "");
        const isActive = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(isActive ? "" : opt)}
            className={` border px-2 py-0.5 text-[10px] font-mono transition-colors ${
              isActive
                ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            title={opt}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SelectControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full  border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500 hover:border-zinc-700 transition-colors cursor-pointer"
    >
      <option value="">none</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
