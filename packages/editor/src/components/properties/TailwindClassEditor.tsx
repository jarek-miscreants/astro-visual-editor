import { useState, useRef, useEffect } from "react";
import { X, Search, ChevronDown } from "lucide-react";
import { searchClasses, type TailwindClassInfo } from "../../lib/tailwind-classes";
import { parseClasses, joinClasses } from "../../lib/class-utils";
import { getAlternatives } from "../../lib/class-alternatives";

interface TailwindClassEditorProps {
  nodeId: string;
  classes: string;
  onClassesChange: (classes: string) => void;
}

export function TailwindClassEditor({
  nodeId,
  classes,
  onClassesChange,
}: TailwindClassEditorProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<TailwindClassInfo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const classList = parseClasses(classes);

  useEffect(() => {
    if (inputValue.trim()) {
      const results = searchClasses(inputValue);
      setSuggestions(results.slice(0, 15));
      setSelectedIdx(0);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [inputValue]);

  function addClass(className: string) {
    if (!classList.includes(className)) {
      onClassesChange(joinClasses([...classList, className]));
    }
    setInputValue("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeClass(className: string) {
    onClassesChange(joinClasses(classList.filter((c) => c !== className)));
  }

  function replaceClass(oldClass: string, newClass: string) {
    onClassesChange(
      joinClasses(classList.map((c) => (c === oldClass ? newClass : c)))
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions[selectedIdx]) {
        addClass(suggestions[selectedIdx].name);
      } else if (inputValue.trim()) {
        addClass(inputValue.trim());
      }
    } else if (e.key === "Backspace" && !inputValue && classList.length > 0) {
      removeClass(classList[classList.length - 1]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  return (
    <div className="tve-prop-stack--sm">
      {/* Smart class chips */}
      <div className="tve-prop-chips">
        {classList.map((cls) => (
          <SmartClassChip
            key={cls}
            className={cls}
            onRemove={() => removeClass(cls)}
            onReplace={(newCls) => replaceClass(cls, newCls)}
          />
        ))}
      </div>

      {/* Search input */}
      <div style={{ position: "relative" }}>
        <div className="tve-prop-search">
          <Search size={11} className="tve-prop-search__icon" />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => inputValue && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Add class..."
            className="tve-prop-search__input"
          />
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="tve-prop-popover tve-prop-popover--wide">
            {suggestions.map((item, idx) => (
              <button
                key={item.name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addClass(item.name);
                }}
                className="tve-prop-popover__item"
                data-active={idx === selectedIdx || undefined}
              >
                {item.color && (
                  <span
                    className="tve-prop-popover__swatch"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="tve-prop-popover__name">{item.name}</span>
                <span className="tve-prop-popover__meta">{item.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A class chip that opens a dropdown of related alternatives when clicked */
function SmartClassChip({
  className,
  onRemove,
  onReplace,
}: {
  className: string;
  onRemove: () => void;
  onReplace: (newClass: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const alternatives = getAlternatives(className);
  const hasAlts = alternatives.length > 1;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="tve-prop-chip-wrapper">
      <span
        className="tve-prop-chip"
        data-open={open || undefined}
        data-clickable={hasAlts || undefined}
        onClick={() => hasAlts && setOpen(!open)}
      >
        {className}
        {hasAlts && (
          <ChevronDown size={8} className="tve-prop-chip__chevron" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="tve-prop-chip__remove"
        >
          <X size={8} />
        </button>
      </span>

      {open && (
        <div className="tve-prop-popover tve-prop-popover--alts">
          {alternatives.map((alt) => (
            <button
              key={alt.value}
              onMouseDown={(e) => {
                e.preventDefault();
                if (alt.value !== className) {
                  onReplace(alt.value);
                }
                setOpen(false);
              }}
              className="tve-prop-popover__item"
              data-active={alt.value === className || undefined}
            >
              {alt.color && (
                <span
                  className="tve-prop-popover__swatch"
                  style={{ backgroundColor: alt.color }}
                />
              )}
              <span className="tve-prop-popover__name">{alt.value}</span>
              {alt.label && (
                <span className="tve-prop-popover__meta">{alt.label}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
