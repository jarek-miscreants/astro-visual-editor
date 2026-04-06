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
    <div className="space-y-3">
      <BoxModelEditor
        label="Margin"
        prefix="m"
        classes={classes}
        onClassesChange={onClassesChange}
        color="orange"
      />
      <BoxModelEditor
        label="Padding"
        prefix="p"
        classes={classes}
        onClassesChange={onClassesChange}
        color="green"
      />
    </div>
  );
}

function BoxModelEditor({
  label,
  prefix,
  classes,
  onClassesChange,
  color,
}: {
  label: string;
  prefix: "m" | "p";
  classes: string;
  onClassesChange: (classes: string) => void;
  color: "orange" | "green";
}) {
  const bgColor = color === "orange" ? "bg-orange-500/10" : "bg-green-500/10";
  const borderColor = color === "orange" ? "border-orange-500/30" : "border-green-500/30";
  const textColor = color === "orange" ? "text-orange-400" : "text-green-400";

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
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${textColor}`}>
          {label}
        </span>
        <SpacingDropdown
          value={allValue ?? ""}
          onChange={setAll}
          placeholder="all"
          prefix={prefix}
        />
      </div>

      {/* Visual box model */}
      <div className={`relative rounded border ${borderColor} ${bgColor} p-1`}>
        {/* Top */}
        <div className="flex justify-center">
          <SpacingDropdown value={top} onChange={(v) => setSide("t", v)} placeholder="−" prefix={prefix} side="t" />
        </div>

        {/* Middle row: left - content - right */}
        <div className="flex items-center justify-between py-1">
          <SpacingDropdown value={left} onChange={(v) => setSide("l", v)} placeholder="−" prefix={prefix} side="l" />
          <div className="mx-2 flex-1 rounded bg-zinc-800 py-2 text-center text-[9px] text-zinc-500">
            content
          </div>
          <SpacingDropdown value={right} onChange={(v) => setSide("r", v)} placeholder="−" prefix={prefix} side="r" />
        </div>

        {/* Bottom */}
        <div className="flex justify-center">
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
      className="w-12 rounded bg-zinc-800 px-0.5 py-0.5 text-center text-[10px] text-zinc-300 outline-none border border-transparent hover:border-zinc-600 focus:border-blue-500 appearance-none cursor-pointer"
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
