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
    <div className="space-y-2">
      {/* Smart class chips */}
      <div className="flex flex-wrap gap-1">
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
      <div className="relative">
        <div className="flex items-center gap-1  border border-zinc-700 bg-zinc-800 px-2">
          <Search size={11} className="text-zinc-500" />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => inputValue && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Add class..."
            className="w-full bg-transparent py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto  border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
            {suggestions.map((item, idx) => (
              <button
                key={item.name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addClass(item.name);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs ${
                  idx === selectedIdx
                    ? "bg-blue-600/20 text-blue-300"
                    : "text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {item.color && (
                  <span
                    className="h-3 w-3 shrink-0  border border-zinc-600"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="font-mono">{item.name}</span>
                <span className="ml-auto text-[10px] text-zinc-500">
                  {item.category}
                </span>
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
    <div ref={ref} className="relative">
      <span
        className={`group flex items-center gap-0.5  px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
          open
            ? "bg-blue-600/20 text-blue-300 border border-blue-500/40"
            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-transparent"
        } ${hasAlts ? "cursor-pointer" : ""}`}
        onClick={() => hasAlts && setOpen(!open)}
      >
        {className}
        {hasAlts && (
          <ChevronDown
            size={8}
            className={`ml-0.5 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5  p-0.5 text-zinc-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
        >
          <X size={8} />
        </button>
      </span>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-52 w-40 overflow-auto  border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
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
              className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] ${
                alt.value === className
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {alt.color && (
                <span
                  className="h-3 w-3 shrink-0  border border-zinc-600"
                  style={{ backgroundColor: alt.color }}
                />
              )}
              <span className="font-mono">{alt.value}</span>
              {alt.label && (
                <span className="ml-auto text-[9px] text-zinc-500">{alt.label}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
