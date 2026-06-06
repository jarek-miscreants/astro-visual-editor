import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Globe2,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Save,
  Share2,
} from "lucide-react";
import type { SeoPageData, SeoPageResponse, SeoWarning } from "@tve/shared";
import { api, nullableProjectAssetPreviewUrl } from "../../lib/api-client";
import { toast } from "../../store/toast-store";
import { useEditorStore } from "../../store/editor-store";
import { ImagePickerDialog } from "../dialogs/ImagePickerDialog";

type SeoStringKey = Exclude<keyof SeoPageData, "noindex">;
type SeoMirrorMode = "same" | "custom";

const EMPTY_SEO: SeoPageData = {
  title: "",
  description: "",
  canonical: "",
  ogTitle: "",
  ogDescription: "",
  ogImage: "",
  twitterImage: "",
  noindex: false,
};

function toDraft(data: Partial<SeoPageData> | undefined): SeoPageData {
  return {
    ...EMPTY_SEO,
    ...(data ?? {}),
    noindex: data?.noindex === true,
  };
}

function routePathFromPageFile(filePath: string | null | undefined): string {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.startsWith("src/pages/")) return "";
  const withoutPrefix = normalized.slice("src/pages/".length);
  const withoutExt = withoutPrefix.replace(/\.(astro|mdx?|html)$/i, "");
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, "");
  const routePath = `/${withoutIndex}`.replace(/\/+/g, "/");
  return routePath === "" ? "/" : routePath;
}

function toDraftWithDefaults(
  data: Partial<SeoPageData> | undefined,
  currentFile: string | null
): SeoPageData {
  const draft = toDraft(data);
  if (!draft.canonical.trim()) {
    draft.canonical = routePathFromPageFile(currentFile);
  }
  return draft;
}

function fieldValue(draft: SeoPageData, key: SeoStringKey): string {
  return draft[key] ?? "";
}

function warningTone(warning: SeoWarning): string {
  if (warning.severity === "error") return "error";
  if (warning.severity === "warning") return "warning";
  return "info";
}

const LIVE_WARNING_CODES = new Set([
  "missing-title",
  "missing-description",
  "title-long",
  "description-long",
  "noindex",
]);

function buildLiveWarnings(
  draft: SeoPageData,
  seo: SeoPageResponse | null
): SeoWarning[] {
  const serverWarnings =
    seo?.warnings.filter((warning) => !LIVE_WARNING_CODES.has(warning.code)) ?? [];
  if (!seo || (!seo.found && !seo.canInsert)) return serverWarnings;

  const warnings: SeoWarning[] = [...serverWarnings];
  const title = draft.title.trim();
  const description = draft.description.trim();

  if (!title) {
    warnings.push({ code: "missing-title", message: "Missing page title.", severity: "warning" });
  } else if (title.length > 60) {
    warnings.push({ code: "title-long", message: "Title is longer than 60 characters.", severity: "info" });
  }

  if (!description) {
    warnings.push({ code: "missing-description", message: "Missing meta description.", severity: "warning" });
  } else if (description.length > 160) {
    warnings.push({ code: "description-long", message: "Description is longer than 160 characters.", severity: "info" });
  }

  if (draft.noindex) {
    warnings.push({ code: "noindex", message: "This page is marked noindex.", severity: "warning" });
  }

  return warnings;
}

export function SeoPanel() {
  const currentFile = useEditorStore((s) => s.currentFile);
  const isPage =
    !!currentFile &&
    currentFile.startsWith("src/pages/") &&
    currentFile.endsWith(".astro");
  const [seo, setSeo] = useState<SeoPageResponse | null>(null);
  const [draft, setDraft] = useState<SeoPageData>(EMPTY_SEO);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePickerField, setImagePickerField] = useState<SeoStringKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentFile || !isPage) {
      setSeo(null);
      setDraft(EMPTY_SEO);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    api
      .getSeoPage(currentFile)
      .then((next) => {
        if (cancelled) return;
        setSeo(next);
        setDraft(toDraftWithDefaults(next.data, currentFile));
      })
      .catch((err) => {
        if (cancelled) return;
        setSeo(null);
        setError(err?.message || "Failed to load SEO metadata");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentFile, isPage]);

  const updateString = (key: SeoStringKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateNoindex = (value: boolean) => {
    setDraft((current) => ({ ...current, noindex: value }));
  };

  const canonicalFallback = routePathFromPageFile(currentFile) || "/";
  const titlePreview = draft.title.trim() || "Untitled page";
  const descriptionPreview =
    draft.description.trim() || "No meta description yet.";
  const canonicalPreview = draft.canonical.trim() || canonicalFallback;
  const socialTitle = draft.ogTitle.trim() || titlePreview;
  const socialDescription = draft.ogDescription.trim() || descriptionPreview;
  const socialImage = draft.ogImage.trim() || draft.twitterImage.trim();
  const socialPreviewUrl = useMemo(
    () => nullableProjectAssetPreviewUrl(socialImage),
    [socialImage]
  );
  const activeWarnings = useMemo(() => buildLiveWarnings(draft, seo), [draft, seo]);

  function canEdit(key: keyof SeoPageData): boolean {
    if (!seo) return false;
    if (!seo.found) return seo.canInsert;
    return seo.fields[key]?.writable ?? false;
  }

  async function save() {
    if (!currentFile || !seo) return;
    setSaving(true);
    setError(null);
    try {
      const next = seo.found
        ? await api.updateSeoPage(currentFile, draft)
        : await api.addSeoPage(currentFile, draft);
      setSeo(next);
      setDraft(toDraft(next.data));
      toast.success(seo.found ? "SEO saved" : "SEO added", currentFile);
    } catch (err: any) {
      const message = err?.message || "Failed to save SEO metadata";
      setError(message);
      toast.error("SEO save failed", message);
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    if (!currentFile) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getSeoPage(currentFile);
      setSeo(next);
      setDraft(toDraftWithDefaults(next.data, currentFile));
    } catch (err: any) {
      setError(err?.message || "Failed to load SEO metadata");
    } finally {
      setLoading(false);
    }
  }

  if (!isPage) {
    return (
      <div className="tve-empty">
        <div className="tve-empty__icon">
          <Globe2 size={16} />
        </div>
        <div>
          <div className="tve-empty__title">No Astro page open</div>
          <p className="tve-empty__desc">Open a page from src/pages.</p>
        </div>
      </div>
    );
  }

  if (loading && !seo) {
    return <div className="tve-prop-status">Loading SEO...</div>;
  }

  const saveDisabled =
    saving ||
    loading ||
    !seo ||
    (!seo.found && !seo.canInsert);
  const ogTitleMode: SeoMirrorMode = draft.ogTitle.trim() ? "custom" : "same";
  const ogDescriptionMode: SeoMirrorMode = draft.ogDescription.trim() ? "custom" : "same";

  return (
    <div className="tve-seo-panel">
      <div className="tve-prop-section">
        <div className="tve-prop-section__header" style={{ justifyContent: "space-between" }}>
          <span className="tve-prop-row">
            <Globe2 size={11} className="tve-prop-section__header-icon--link" />
            Search
          </span>
          <span className="tve-seo-adapter">
            {seo?.adapter === "component" ? "Component" : seo?.canInsert ? "Ready" : "Setup"}
          </span>
        </div>

        {error && (
          <div className="tve-prop-warning-card" data-tone="error">
            <div className="tve-prop-warning-card__title">SEO error</div>
            <div className="tve-prop-warning-card__desc">{error}</div>
          </div>
        )}

        {activeWarnings.length > 0 && (
          <div className="tve-prop-stack--xs">
            {activeWarnings.map((warning) => (
              <div
                key={warning.code}
                className="tve-seo-warning"
                data-tone={warningTone(warning)}
              >
                <AlertTriangle size={11} />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="tve-prop-stack">
          <SeoTextField
            label="Title"
            value={fieldValue(draft, "title")}
            maxLength={60}
            disabled={!canEdit("title")}
            reason={seo?.fields.title.reason}
            onChange={(value) => updateString("title", value)}
          />
          <SeoTextareaField
            label="Description"
            value={fieldValue(draft, "description")}
            maxLength={160}
            disabled={!canEdit("description")}
            reason={seo?.fields.description.reason}
            onChange={(value) => updateString("description", value)}
          />
          <SeoTextField
            label="Canonical"
            value={fieldValue(draft, "canonical")}
            disabled={!canEdit("canonical")}
            reason={seo?.fields.canonical.reason}
            placeholder={canonicalFallback}
            onChange={(value) => updateString("canonical", value)}
          />
          <label className="tve-prop-bool">
            <input
              type="checkbox"
              checked={draft.noindex}
              disabled={!canEdit("noindex")}
              onChange={(e) => updateNoindex(e.target.checked)}
              className="tve-prop-bool__check"
            />
            <span className="tve-prop-bool__state">Noindex</span>
          </label>
        </div>
      </div>

      <div className="tve-prop-section">
        <div className="tve-prop-section__header">
          <Share2 size={11} className="tve-prop-section__header-icon--sparkle" />
          Social
        </div>
        <div className="tve-prop-stack">
          <SeoMirrorField
            label="OG title"
            sameLabel="Same as Meta Title"
            value={fieldValue(draft, "ogTitle")}
            mode={ogTitleMode}
            disabled={!canEdit("ogTitle")}
            reason={seo?.fields.ogTitle.reason}
            placeholder={titlePreview}
            onModeChange={(mode) => {
              if (mode === "same") updateString("ogTitle", "");
              else updateString("ogTitle", titlePreview === "Untitled page" ? "" : titlePreview);
            }}
            onChange={(value) => updateString("ogTitle", value)}
          />
          <SeoMirrorField
            label="OG description"
            sameLabel="Same as Meta Description"
            value={fieldValue(draft, "ogDescription")}
            mode={ogDescriptionMode}
            disabled={!canEdit("ogDescription")}
            reason={seo?.fields.ogDescription.reason}
            placeholder={descriptionPreview}
            multiline
            onModeChange={(mode) => {
              if (mode === "same") updateString("ogDescription", "");
              else updateString("ogDescription", descriptionPreview === "No meta description yet." ? "" : descriptionPreview);
            }}
            onChange={(value) => updateString("ogDescription", value)}
          />
          <SeoImageField
            label="OG image"
            value={fieldValue(draft, "ogImage")}
            disabled={!canEdit("ogImage")}
            reason={seo?.fields.ogImage.reason}
            onChange={(value) => updateString("ogImage", value)}
            onPick={() => setImagePickerField("ogImage")}
          />
          <SeoImageField
            label="Twitter image"
            value={fieldValue(draft, "twitterImage")}
            disabled={!canEdit("twitterImage")}
            reason={seo?.fields.twitterImage.reason}
            onChange={(value) => updateString("twitterImage", value)}
            onPick={() => setImagePickerField("twitterImage")}
          />
        </div>
      </div>

      <div className="tve-prop-section">
        <div className="tve-prop-section__header">Preview</div>
        <div className="tve-seo-search-preview">
          <div className="tve-seo-search-preview__title">{titlePreview}</div>
          <div className="tve-seo-search-preview__url">{canonicalPreview}</div>
          <div className="tve-seo-search-preview__desc">{descriptionPreview}</div>
        </div>
        <div className="tve-seo-social-preview">
          <div className="tve-seo-social-preview__image">
            {socialPreviewUrl ? (
              <img src={socialPreviewUrl} alt="" />
            ) : (
              <ImageIcon size={18} />
            )}
          </div>
          <div className="tve-seo-social-preview__body">
            <div className="tve-seo-social-preview__title">{socialTitle}</div>
            <div className="tve-seo-social-preview__desc">{socialDescription}</div>
          </div>
        </div>
      </div>

      <div className="tve-seo-actions">
        <button
          type="button"
          className="tve-button-secondary"
          onClick={refresh}
          disabled={loading || saving}
          title="Refresh SEO"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
        <button
          type="button"
          className="tve-button-accent"
          onClick={save}
          disabled={saveDisabled}
        >
          {seo?.found ? <Save size={12} /> : <Plus size={12} />}
          {saving ? "Saving..." : seo?.found ? "Save SEO" : "Add SEO"}
        </button>
      </div>

      {seo?.found && (
        <div className="tve-seo-saved">
          <Check size={11} />
          <span>SEO source found on this page</span>
        </div>
      )}

      {imagePickerField && (
        <ImagePickerDialog
          currentSrc={fieldValue(draft, imagePickerField)}
          onSelect={(url) => updateString(imagePickerField, url)}
          onClose={() => setImagePickerField(null)}
        />
      )}
    </div>
  );
}

function SeoTextField({
  label,
  value,
  disabled,
  reason,
  placeholder,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  reason?: string;
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="tve-prop-field">
      <span className="tve-prop-field__label">
        {label}
        {maxLength && <span className="tve-seo-count">{value.length}/{maxLength}</span>}
      </span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="tve-prop-input"
      />
      {disabled && reason && <span className="tve-seo-field-note">{reason}</span>}
    </label>
  );
}

function SeoMirrorField({
  label,
  sameLabel,
  value,
  mode,
  disabled,
  reason,
  placeholder,
  multiline = false,
  onModeChange,
  onChange,
}: {
  label: string;
  sameLabel: string;
  value: string;
  mode: SeoMirrorMode;
  disabled: boolean;
  reason?: string;
  placeholder?: string;
  multiline?: boolean;
  onModeChange: (mode: SeoMirrorMode) => void;
  onChange: (value: string) => void;
}) {
  const inputDisabled = disabled || mode === "same";
  return (
    <div className="tve-prop-field">
      <div className="tve-prop-field__label">{label}</div>
      <div className="tve-seo-mirror">
        <label className="tve-seo-mirror-toggle" data-active={mode === "same"}>
          <input
            type="checkbox"
            checked={mode === "same"}
            disabled={disabled}
            onChange={(e) => onModeChange(e.target.checked ? "same" : "custom")}
            className="tve-seo-mirror-toggle__input"
          />
          <span className="tve-seo-mirror-toggle__switch" aria-hidden="true" />
          <span className="tve-seo-mirror-toggle__label">{sameLabel}</span>
          <span className="tve-seo-mirror-toggle__state">
            {mode === "same" ? "On" : "Custom"}
          </span>
        </label>
        {multiline ? (
          <textarea
            value={value}
            disabled={inputDisabled}
            placeholder={placeholder}
            rows={3}
            onChange={(e) => onChange(e.target.value)}
            className="tve-prop-textarea"
          />
        ) : (
          <input
            type="text"
            value={value}
            disabled={inputDisabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="tve-prop-input"
          />
        )}
      </div>
      {mode === "same" && !disabled && (
        <span className="tve-seo-field-note">Saved as inherited; no explicit OG prop is written.</span>
      )}
      {disabled && reason && <span className="tve-seo-field-note">{reason}</span>}
    </div>
  );
}

function SeoTextareaField({
  label,
  value,
  disabled,
  reason,
  placeholder,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  reason?: string;
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="tve-prop-field">
      <span className="tve-prop-field__label">
        {label}
        {maxLength && <span className="tve-seo-count">{value.length}/{maxLength}</span>}
      </span>
      <textarea
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className="tve-prop-textarea"
      />
      {disabled && reason && <span className="tve-seo-field-note">{reason}</span>}
    </label>
  );
}

function SeoImageField({
  label,
  value,
  disabled,
  reason,
  onChange,
  onPick,
}: {
  label: string;
  value: string;
  disabled: boolean;
  reason?: string;
  onChange: (value: string) => void;
  onPick: () => void;
}) {
  const preview = nullableProjectAssetPreviewUrl(value);
  return (
    <div className="tve-prop-field">
      <div className="tve-prop-field__label">{label}</div>
      <div className="tve-seo-image-row">
        <div className="tve-seo-image-thumb">
          {preview ? <img src={preview} alt="" /> : <ImageIcon size={14} />}
        </div>
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder="/images/share.webp"
          onChange={(e) => onChange(e.target.value)}
          className="tve-prop-input"
        />
        <button
          type="button"
          className="tve-prop-icon-action"
          disabled={disabled}
          onClick={onPick}
          title="Choose image"
        >
          <ImageIcon size={13} />
        </button>
      </div>
      {disabled && reason && <span className="tve-seo-field-note">{reason}</span>}
    </div>
  );
}
