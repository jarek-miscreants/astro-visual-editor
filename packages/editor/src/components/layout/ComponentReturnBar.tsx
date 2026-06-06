import { ArrowLeft, Component } from "lucide-react";
import { useEditorStore } from "../../store/editor-store";

export function ComponentReturnBar() {
  const currentFile = useEditorStore((s) => s.currentFile);
  const target = useEditorStore((s) => s.componentReturnTarget);
  const returnToComponentOrigin = useEditorStore((s) => s.returnToComponentOrigin);

  if (!target || !currentFile?.startsWith("src/components/")) return null;

  return (
    <div className="tve-component-return">
      <button
        type="button"
        className="tve-component-return__button"
        onClick={() => void returnToComponentOrigin()}
        aria-label={`Back to ${target.label}`}
      >
        <ArrowLeft size={12} />
        <span>Back to {target.label}</span>
      </button>
      <span className="tve-component-return__meta">
        <Component size={11} />
        {target.componentTagName}
      </span>
    </div>
  );
}
