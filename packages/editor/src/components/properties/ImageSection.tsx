import { useState } from "react";
import { Image as ImageIcon, Code2, Replace } from "lucide-react";
import { assetRawUrl } from "../../lib/api-client";
import { ImagePickerDialog } from "../dialogs/ImagePickerDialog";

interface ImageSectionProps {
  /** Current `src` attribute value. May be an Astro expression (`{x.src}`). */
  src: string | undefined;
  /** Apply a new plain-string src. */
  onChange: (value: string) => void;
}

/** Is this src a project-local `public/` URL we can preview + replace? Absolute
 *  http(s) URLs and Astro expressions are shown but not previewed locally. */
function isLocalPublicUrl(src: string): boolean {
  return src.startsWith("/") && !src.startsWith("//");
}

/**
 * Image source editor for `<img>` elements (Dev mode). Shows the current
 * image, the src string, and a "Replace" button that opens the asset browser.
 * When src is bound to an Astro expression (`{imported.src}`), editing is
 * disabled — overwriting it with a string would break the import. That case
 * shows a read-only note instead, mirroring the class-expression guard.
 */
export function ImageSection({ src, onChange }: ImageSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const value = src ?? "";
  const isExpression = value.startsWith("{") && value.endsWith("}");
  const localPreview = isLocalPublicUrl(value);
  const previewUrl = localPreview
    ? assetRawUrl("public" + value)
    : !isExpression && value
      ? value
      : null;

  return (
    <div className="tve-prop-section">
      <div className="tve-prop-section__header">
        <ImageIcon size={11} style={{ marginRight: 4 }} />
        Image
      </div>

      {isExpression ? (
        <div className="tve-prop-warning-card">
          <div className="tve-prop-warning-card__title">Imported image</div>
          <div className="tve-prop-warning-card__code">src={value}</div>
          <div className="tve-prop-warning-card__desc">
            This image is bound to a frontmatter import. Choosing from the
            library would break the binding, so it's disabled here — edit the
            import in source, or use a <span style={{ fontFamily: "monospace" }}>public/</span>{" "}
            image with a plain <span style={{ fontFamily: "monospace" }}>src</span>.
          </div>
        </div>
      ) : (
        <div className="tve-prop-stack--sm">
          <div
            className="flex items-center justify-center overflow-hidden border border-zinc-700 bg-[repeating-conic-gradient(#27272a_0%_25%,#1c1c1f_0%_50%)] bg-[length:16px_16px]"
            style={{ height: 120 }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Current"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-zinc-600">No image</span>
            )}
          </div>

          <input
            type="text"
            key={value}
            defaultValue={value}
            placeholder="/images/photo.webp or https://…"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== value) onChange(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="tve-prop-input tve-prop-input--mono"
          />

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="tve-prop-action-btn"
          >
            <Replace size={12} />
            Choose from library…
          </button>
        </div>
      )}

      {pickerOpen && (
        <ImagePickerDialog
          currentSrc={localPreview ? value : undefined}
          onSelect={(url) => onChange(url)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
