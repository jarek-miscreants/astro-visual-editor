import { useState } from "react";
import { TypographyControls } from "./TypographyControls";

interface TextTabProps {
  nodeId: string;
  classes: string;
  textContent: string | null;
  onClassesChange: (classes: string) => void;
  onTextChange: (text: string) => void;
}

export function TextTab({
  nodeId,
  classes,
  textContent,
  onClassesChange,
  onTextChange,
}: TextTabProps) {
  return (
    <div>
      {/* Typography controls */}
      <div className="tve-prop-section">
        <TypographyControls classes={classes} onClassesChange={onClassesChange} />
      </div>

      {/* Content editor */}
      {textContent !== null && (
        <div className="tve-prop-section">
          <div className="tve-prop-section__header">Content</div>
          <TextContentEditor text={textContent} onTextChange={onTextChange} />
        </div>
      )}
    </div>
  );
}

function TextContentEditor({
  text,
  onTextChange,
}: {
  text: string;
  onTextChange: (text: string) => void;
}) {
  const [value, setValue] = useState(text);

  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== text) onTextChange(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="tve-prop-textarea"
      style={{ resize: "none" }}
      rows={3}
    />
  );
}
