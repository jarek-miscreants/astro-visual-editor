import { useState } from "react";
import { SpacingControls } from "./SpacingControls";
import { ColorControls } from "./ColorControls";
import {
  hasClass,
  getClassByPrefix,
  replaceClassFromSet,
  replaceClassByPrefix,
} from "../../lib/class-utils";

interface StyleTabProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

const BORDER_WIDTH = ["border-0", "border", "border-2", "border-4", "border-8"];
const BORDER_RADIUS = [
  "rounded-none", "rounded-sm", "rounded", "rounded-md",
  "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full",
];
const SHADOW = [
  "shadow-none", "shadow-sm", "shadow", "shadow-md",
  "shadow-lg", "shadow-xl", "shadow-2xl",
];
const OPACITY = [
  "opacity-0", "opacity-5", "opacity-10", "opacity-20", "opacity-25",
  "opacity-30", "opacity-40", "opacity-50", "opacity-60", "opacity-70",
  "opacity-75", "opacity-80", "opacity-90", "opacity-95", "opacity-100",
];

export function StyleTab({ classes, onClassesChange }: StyleTabProps) {
  return (
    <div className="space-y-0">
      {/* Colors */}
      <Section title="Colors">
        <ColorControls classes={classes} onClassesChange={onClassesChange} />
      </Section>

      {/* Spacing */}
      <Section title="Spacing">
        <SpacingControls classes={classes} onClassesChange={onClassesChange} />
      </Section>

      {/* Borders */}
      <Section title="Borders">
        <div className="space-y-2">
          <ControlRow label="Width">
            <ButtonRow
              options={BORDER_WIDTH}
              labels={["0", "1", "2", "4", "8"]}
              classes={classes}
              set={BORDER_WIDTH}
              onClassesChange={onClassesChange}
            />
          </ControlRow>
          <ControlRow label="Radius">
            <select
              value={BORDER_RADIUS.find((r) => hasClass(classes, r)) || ""}
              onChange={(e) => onClassesChange(replaceClassFromSet(classes, BORDER_RADIUS, e.target.value))}
              className="tve-prop-select"
            >
              <option value="">none</option>
              {BORDER_RADIUS.map((r) => (
                <option key={r} value={r}>{r.replace("rounded-", "").replace("rounded", "default")}</option>
              ))}
            </select>
          </ControlRow>
        </div>
      </Section>

      {/* Effects */}
      <Section title="Effects">
        <div className="space-y-2">
          <ControlRow label="Shadow">
            <select
              value={SHADOW.find((s) => hasClass(classes, s)) || ""}
              onChange={(e) => onClassesChange(replaceClassFromSet(classes, SHADOW, e.target.value))}
              className="tve-prop-select"
            >
              <option value="">none</option>
              {SHADOW.map((s) => (
                <option key={s} value={s}>{s.replace("shadow-", "").replace("shadow", "default")}</option>
              ))}
            </select>
          </ControlRow>
          <ControlRow label="Opacity">
            <select
              value={OPACITY.find((o) => hasClass(classes, o)) || ""}
              onChange={(e) => onClassesChange(replaceClassFromSet(classes, OPACITY, e.target.value))}
              className="tve-prop-select"
            >
              <option value="">100%</option>
              {OPACITY.map((o) => (
                <option key={o} value={o}>{o.replace("opacity-", "")}%</option>
              ))}
            </select>
          </ControlRow>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{ borderBottom: "1px solid var(--prop-section-border)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="tve-prop-section__header tve-prop-section__header--toggle"
        style={{ justifyContent: "space-between", padding: "10px 12px", margin: 0 }}
      >
        {title}
        <span style={{ color: "var(--prop-icon-color)", fontSize: 12, lineHeight: 1 }}>
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tve-prop-field">
      <div className="tve-prop-field__label">{label}</div>
      {children}
    </div>
  );
}

function ButtonRow({
  options,
  labels,
  classes,
  set,
  onClassesChange,
}: {
  options: string[];
  labels: string[];
  classes: string;
  set: string[];
  onClassesChange: (classes: string) => void;
}) {
  const current = options.find((o) => hasClass(classes, o)) || "";
  return (
    <div className="tve-prop-toggle-group">
      {options.map((opt, i) => (
        <button
          key={opt}
          onClick={() => onClassesChange(replaceClassFromSet(classes, set, opt === current ? "" : opt))}
          className="tve-prop-toggle"
          data-active={opt === current || undefined}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}
