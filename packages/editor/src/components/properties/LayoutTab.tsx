import { LayoutControls } from "./LayoutControls";
import {
  hasClass,
  getClassByPrefix,
  replaceClassByPrefix,
  replaceClassFromSet,
} from "../../lib/class-utils";
import { SPACING_SCALE } from "../../lib/tailwind-defaults";

interface LayoutTabProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

const OVERFLOW = ["overflow-auto", "overflow-hidden", "overflow-visible", "overflow-scroll"];

export function LayoutTab({ classes, onClassesChange }: LayoutTabProps) {
  return (
    <div>
      {/* Display, Position, Flex/Grid */}
      <div className="tve-prop-section">
        <LayoutControls classes={classes} onClassesChange={onClassesChange} />
      </div>

      {/* Sizing */}
      <Section title="Size">
        <div className="grid grid-cols-2 gap-2">
          <SizeControl label="Width" prefix="w" classes={classes} onClassesChange={onClassesChange} />
          <SizeControl label="Height" prefix="h" classes={classes} onClassesChange={onClassesChange} />
          <SizeControl label="Min W" prefix="min-w" classes={classes} onClassesChange={onClassesChange} />
          <SizeControl label="Min H" prefix="min-h" classes={classes} onClassesChange={onClassesChange} />
          <SizeControl label="Max W" prefix="max-w" classes={classes} onClassesChange={onClassesChange} />
          <SizeControl label="Max H" prefix="max-h" classes={classes} onClassesChange={onClassesChange} />
        </div>
      </Section>

      {/* Overflow */}
      <Section title="Overflow">
        <select
          value={OVERFLOW.find((o) => hasClass(classes, o)) || ""}
          onChange={(e) => onClassesChange(replaceClassFromSet(classes, OVERFLOW, e.target.value))}
          className="tve-prop-select"
        >
          <option value="">default</option>
          {OVERFLOW.map((o) => (
            <option key={o} value={o}>{o.replace("overflow-", "")}</option>
          ))}
        </select>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tve-prop-section">
      <div className="tve-prop-section__header">{title}</div>
      {children}
    </div>
  );
}

const SIZE_VALUES = [
  "auto", "full", "screen", "min", "max", "fit",
  "1/2", "1/3", "2/3", "1/4", "3/4",
  ...["0", "1", "2", "4", "8", "12", "16", "20", "24", "32", "40", "48", "56", "64", "72", "80", "96"],
];

const MAX_W_VALUES = [
  "none", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "full", "prose",
  "screen-sm", "screen-md", "screen-lg", "screen-xl", "screen-2xl",
];

function SizeControl({
  label,
  prefix,
  classes,
  onClassesChange,
}: {
  label: string;
  prefix: string;
  classes: string;
  onClassesChange: (classes: string) => void;
}) {
  const current = getClassByPrefix(classes, `${prefix}-`);
  const currentValue = current?.replace(`${prefix}-`, "") || "";

  const values = prefix === "max-w" ? MAX_W_VALUES : SIZE_VALUES;

  return (
    <div className="tve-prop-field">
      <div className="tve-prop-field__label">{label}</div>
      <select
        value={currentValue}
        onChange={(e) => {
          const newClass = e.target.value ? `${prefix}-${e.target.value}` : "";
          onClassesChange(replaceClassByPrefix(classes, `${prefix}-`, newClass));
        }}
        className="tve-prop-select tve-prop-select--mono"
      >
        <option value="">auto</option>
        {values.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
