import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link as LinkIcon,
  ExternalLink,
  FileText,
  Globe,
  ChevronDown,
  Search,
} from "lucide-react";
import type { LinkTarget } from "@tve/shared";
import { api } from "../../lib/api-client";

interface Props {
  /** Current href value (empty string if not set) */
  href: string;
  /** Current target attribute, if any */
  target?: string;
  /** Current rel attribute, if any */
  rel?: string;
  /** Emit one attribute change at a time. value=null deletes the attribute. */
  onAttrChange: (attr: string, value: string | null) => void;
  /** Section label override, e.g. "Button link" for components */
  label?: string;
  /** Hide the "Open in new tab" checkbox for components that do not expose target. */
  hideNewTab?: boolean;
}

interface LinkTargetGroup {
  group: string;
  options: LinkTarget[];
}

const NEW_TAB_REL = "noopener noreferrer";

export function LinkSection({
  href,
  target,
  rel,
  onAttrChange,
  label = "Link",
  hideNewTab = false,
}: Props) {
  const [linkTargets, setLinkTargets] = useState<LinkTarget[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [mode, setModeState] = useState<"url" | "page">("url");
  const modeTouchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingTargets(true);
    setTargetError(null);

    api
      .getLinkTargets()
      .then(({ targets }) => {
        if (!cancelled) setLinkTargets(targets);
      })
      .catch((err: any) => {
        if (!cancelled) setTargetError(err.message || "Failed to load link targets");
      })
      .finally(() => {
        if (!cancelled) setLoadingTargets(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const groupedOptions = useMemo<LinkTargetGroup[]>(() => {
    const groups = new Map<string, LinkTarget[]>();
    for (const option of linkTargets) {
      const list = groups.get(option.group) ?? [];
      list.push(option);
      groups.set(option.group, list);
    }

    const collectionGroups = [...groups.keys()]
      .filter((group) => group !== "Pages" && group !== "Templates")
      .sort();
    const order = ["Pages", ...collectionGroups, "Templates"];

    return order
      .filter((group) => groups.has(group))
      .map((group) => ({ group, options: groups.get(group)! }));
  }, [linkTargets]);

  const selectedTarget = useMemo(
    () => linkTargets.find((option) => !option.disabled && option.url === href) ?? null,
    [href, linkTargets]
  );

  useEffect(() => {
    if (modeTouchedRef.current) return;
    setModeState(selectedTarget ? "page" : "url");
  }, [selectedTarget]);

  const isNewTab = target === "_blank";
  const ourRel = rel === NEW_TAB_REL || rel === "noopener" || rel === "noreferrer";
  const isExternalUrl = href.startsWith("http://") || href.startsWith("https://");
  const hasInternalTargets = loadingTargets || linkTargets.length > 0;

  function setMode(nextMode: "url" | "page") {
    modeTouchedRef.current = true;
    setModeState(nextMode);
  }

  function handleNewTabToggle(checked: boolean) {
    if (checked) {
      onAttrChange("target", "_blank");
      if (!rel) onAttrChange("rel", NEW_TAB_REL);
    } else {
      onAttrChange("target", null);
      if (ourRel) onAttrChange("rel", null);
    }
  }

  return (
    <div className="tve-prop-section">
      <div className="tve-prop-section__header" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <LinkIcon size={11} className="tve-prop-section__header-icon--link" />
          {label}
        </span>
        {hasInternalTargets && (
          <div className="tve-prop-mode">
            <button
              type="button"
              onClick={() => setMode("url")}
              className="tve-prop-mode__btn"
              data-active={mode === "url" || undefined}
            >
              <Globe size={9} />
              URL
            </button>
            <button
              type="button"
              onClick={() => setMode("page")}
              className="tve-prop-mode__btn"
              data-active={mode === "page" || undefined}
            >
              <FileText size={9} />
              Page
            </button>
          </div>
        )}
      </div>

      <div className="tve-prop-stack--sm">
        {mode === "url" ? (
          <div className="tve-prop-row">
            <input
              type="text"
              key={href}
              defaultValue={href}
              placeholder="https://... or /path or #anchor"
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== href) onAttrChange("href", value === "" ? null : value);
              }}
              className="tve-prop-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            {isExternalUrl && (
              <button
                type="button"
                onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
                title="Open link in new tab"
                className="tve-prop-link-launch"
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        ) : (
          <LinkTargetPicker
            value={href}
            selectedTarget={selectedTarget}
            groups={groupedOptions}
            loading={loadingTargets}
            error={targetError}
            onChange={(value) => onAttrChange("href", value === "" ? null : value)}
          />
        )}

        {!hideNewTab && (
          <label className="tve-prop-bool">
            <input
              type="checkbox"
              checked={isNewTab}
              onChange={(e) => handleNewTabToggle(e.target.checked)}
              className="tve-prop-bool__check"
            />
            Open in new tab
          </label>
        )}
        {!href && mode === "url" && (
          <p className="tve-prop-section__hint">
            Tip: use <span>/page</span> for internal links, <span>#section</span> for
            in-page anchors, or a full URL for external sites.
          </p>
        )}
      </div>
    </div>
  );
}

function LinkTargetPicker({
  value,
  selectedTarget,
  groups,
  loading,
  error,
  onChange,
}: {
  value: string;
  selectedTarget: LinkTarget | null;
  groups: LinkTargetGroup[];
  loading: boolean;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;

    return groups
      .map(({ group, options }) => ({
        group,
        options: options.filter((option) => targetMatches(option, group, q)),
      }))
      .filter(({ options }) => options.length > 0);
  }, [groups, query]);

  const firstSelectable = useMemo(
    () => filteredGroups.flatMap((group) => group.options).find((option) => !option.disabled),
    [filteredGroups]
  );

  useEffect(() => {
    if (!open) return;

    function onMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const buttonLabel = selectedTarget?.label ?? (value ? value : "Select page or content");
  const buttonMeta = selectedTarget?.url ?? "";

  function choose(option: LinkTarget) {
    if (option.disabled) return;
    onChange(option.url);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="tve-link-picker">
      <button
        type="button"
        className="tve-link-picker__button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="tve-link-picker__button-text">
          <span className="tve-link-picker__button-label">{buttonLabel}</span>
          {buttonMeta && <span className="tve-link-picker__button-meta">{buttonMeta}</span>}
        </span>
        <ChevronDown size={13} className="tve-link-picker__chevron" />
      </button>

      {open && (
        <div className="tve-link-picker__popover">
          <div className="tve-link-picker__search">
            <Search size={12} className="tve-link-picker__search-icon" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
                if (event.key === "Enter" && firstSelectable) {
                  event.preventDefault();
                  choose(firstSelectable);
                }
              }}
              placeholder="Search pages and content..."
              className="tve-link-picker__search-input"
            />
          </div>

          <div className="tve-link-picker__list">
            {loading && <div className="tve-link-picker__empty">Loading link targets...</div>}
            {error && <div className="tve-link-picker__empty" data-tone="error">{error}</div>}
            {!loading && !error && filteredGroups.length === 0 && (
              <div className="tve-link-picker__empty">No matching pages or content</div>
            )}

            {!loading &&
              !error &&
              filteredGroups.map(({ group, options }) => (
                <div key={group} className="tve-link-picker__group">
                  <div className="tve-link-picker__group-label">{group}</div>
                  {options.map((option) => (
                    <button
                      key={`${option.kind}-${option.routeFile ?? ""}-${option.sourcePath ?? ""}-${option.url}`}
                      type="button"
                      disabled={option.disabled}
                      data-active={!option.disabled && option.url === value ? "true" : undefined}
                      className="tve-link-picker__option"
                      onClick={() => choose(option)}
                    >
                      <span className="tve-link-picker__option-main">
                        <span className="tve-link-picker__option-label">{option.label}</span>
                        <span className="tve-link-picker__option-url">{option.url}</span>
                      </span>
                      <span className="tve-link-picker__option-meta">
                        {option.kind === "content" ? option.collection : option.kind}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function targetMatches(option: LinkTarget, group: string, query: string): boolean {
  return [
    option.label,
    option.url,
    group,
    option.collection,
    option.slug,
    option.sourcePath,
    option.routeFile,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}
