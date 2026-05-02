import { useState } from "react";
import {
  getClassByPrefix,
  replaceClassByPrefix,
  extractValue,
  SPACING_SCALE,
  SPACING_LABELS,
} from "../../lib/class-utils";

interface SpacingControlsProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

const SIDES = ["t", "r", "b", "l"] as const;
const SIDE_LABELS = { t: "top", r: "right", b: "bottom", l: "left" };

export function SpacingControls({ classes, onClassesChange }: SpacingControlsProps) {
  return (
    <div className="tve-prop-stack">
      <BoxModelEditor
        label="Margin"
        prefix="m"
        classes={classes}
        onClassesChange={onClassesChange}
      />
      <BoxModelEditor
        label="Padding"
        prefix="p"
        classes={classes}
        onClassesChange={onClassesChange}
      />
    </div>
  );
}

function BoxModelEditor({
  label,
  prefix,
  classes,
  onClassesChange,
}: {
  label: string;
  prefix: "m" | "p";
  classes: string;
  onClassesChange: (classes: string) => void;
}) {

  // Read current values
  const allValue = getCurrentValue(classes, `${prefix}-`);
  const xValue = getCurrentValue(classes, `${prefix}x-`);
  const yValue = getCurrentValue(classes, `${prefix}y-`);
  const tValue = getCurrentValue(classes, `${prefix}t-`);
  const rValue = getCurrentValue(classes, `${prefix}r-`);
  const bValue = getCurrentValue(classes, `${prefix}b-`);
  const lValue = getCurrentValue(classes, `${prefix}l-`);

  // Resolve effective values (specific > axis > all)
  const top = tValue ?? yValue ?? allValue ?? "";
  const right = rValue ?? xValue ?? allValue ?? "";
  const bottom = bValue ?? yValue ?? allValue ?? "";
  const left = lValue ?? xValue ?? allValue ?? "";

  function setSide(side: "t" | "r" | "b" | "l", value: string) {
    const sidePrefix = `${prefix}${side}-`;
    let updated = classes;

    if (value) {
      updated = replaceClassByPrefix(updated, sidePrefix, `${sidePrefix}${value}`);
    } else {
      updated = replaceClassByPrefix(updated, sidePrefix, "");
    }
    onClassesChange(updated);
  }

  function setAll(value: string) {
    let updated = classes;
    // Remove all specific sides + axes
    for (const s of SIDES) {
      updated = replaceClassByPrefix(updated, `${prefix}${s}-`, "");
    }
    updated = replaceClassByPrefix(updated, `${prefix}x-`, "");
    updated = replaceClassByPrefix(updated, `${prefix}y-`, "");
    updated = replaceClassByPrefix(updated, `${prefix}-`, value ? `${prefix}-${value}` : "");
    onClassesChange(updated);
  }

  return (
    <div>
      <div className="tve-prop-boxmodel-header">
        <span className="tve-prop-boxmodel-header__label">{label}</span>
        <SpacingDropdown
          value={allValue ?? ""}
          onChange={setAll}
          placeholder="all"
          prefix={prefix}
        />
      </div>

      <div className="tve-prop-boxmodel">
        <div className="tve-prop-boxmodel__row">
          <SpacingDropdown value={top} onChange={(v) => setSide("t", v)} placeholder="−" prefix={prefix} side="t" />
        </div>

        <div className="tve-prop-boxmodel__row tve-prop-boxmodel__row--mid">
          <SpacingDropdown value={left} onChange={(v) => setSide("l", v)} placeholder="−" prefix={prefix} side="l" />
          <div className="tve-prop-boxmodel__content">content</div>
          <SpacingDropdown value={right} onChange={(v) => setSide("r", v)} placeholder="−" prefix={prefix} side="r" />
        </div>

        <div className="tve-prop-boxmodel__row">
          <SpacingDropdown value={bottom} onChange={(v) => setSide("b", v)} placeholder="−" prefix={prefix} side="b" />
        </div>
      </div>
    </div>
  );
}

function SpacingDropdown({
  value,
  onChange,
  placeholder,
  prefix,
  side,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  prefix?: string;
  side?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tve-prop-select--xs"
      title={side ? `${prefix}${side}` : `${prefix}-all`}
    >
      <option value="">{placeholder}</option>
      {SPACING_SCALE.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function getCurrentValue(classes: string, prefix: string): string | null {
  const match = getClassByPrefix(classes, prefix);
  if (!match) return null;
  return extractValue(match);
}
