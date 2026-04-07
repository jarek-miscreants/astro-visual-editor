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
    <div className="space-y-0">
      {/* Typography controls */}
      <div className="border-b border-zinc-800 px-3 py-3">
        <TypographyControls classes={classes} onClassesChange={onClassesChange} />
      </div>

      {/* Content editor */}
      {textContent !== null && (
        <div className="border-b border-zinc-800 px-3 py-3">
          <div className="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Content
          </div>
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
      className="w-full  border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none transition-colors"
      rows={3}
    />
  );
}
