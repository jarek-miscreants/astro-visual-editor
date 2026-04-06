import { useState } from "react";
import { Search, Box, Type, Image, MousePointer, List, Component, Layers } from "lucide-react";
import { ELEMENT_TEMPLATES, templateToHtml, type TemplateGroup } from "../../lib/element-templates";
import { useEditorStore } from "../../store/editor-store";

interface AddElementPanelProps {
  onSelect: (html: string) => void;
  onClose: () => void;
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Structure: <Box size={11} />,
  Text: <Type size={11} />,
  Media: <Image size={11} />,
  Interactive: <MousePointer size={11} />,
  List: <List size={11} />,
  Astro: <Layers size={11} />,
};

export function AddElementPanel({ onSelect, onClose }: AddElementPanelProps) {
  const [search, setSearch] = useState("");
  const files = useEditorStore((s) => s.files);

  // Project components
  const components = files.filter((f) => f.type === "component");

  const query = search.toLowerCase();

  return (
    <div className="w-64 max-h-96 overflow-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
      {/* Search */}
      <div className="sticky top-0 z-10 border-b border-zinc-700 bg-zinc-800 p-2">
        <div className="flex items-center gap-1 rounded border border-zinc-600 bg-zinc-900 px-2">
          <Search size={11} className="text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search elements..."
            className="w-full bg-transparent py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            autoFocus
          />
        </div>
      </div>

      <div className="p-1">
        {/* Project components */}
        {components.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
              <Component size={10} />
              Components
            </div>
            {components
              .filter((c) => !query || c.path.toLowerCase().includes(query))
              .map((comp) => {
                const name = comp.path.split("/").pop()?.replace(".astro", "") || comp.path;
                return (
                  <button
                    key={comp.path}
                    onClick={() => onSelect(`<${name} />`)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    <Component size={11} className="text-cyan-400" />
                    <span className="font-mono">{name}</span>
                  </button>
                );
              })}
          </div>
        )}

        {/* HTML element groups */}
        {ELEMENT_TEMPLATES.map((group) => {
          const filtered = group.templates.filter(
            (t) => !query || t.tag.includes(query) || t.label.toLowerCase().includes(query)
          );
          if (filtered.length === 0) return null;

          return (
            <div key={group.label} className="mb-1">
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {GROUP_ICONS[group.label] || <Box size={10} />}
                {group.label}
              </div>
              {filtered.map((template) => (
                <button
                  key={template.tag + template.label}
                  onClick={() => onSelect(templateToHtml(template))}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  <span className="font-mono text-blue-400">&lt;{template.tag}&gt;</span>
                  <span className="text-zinc-500">{template.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
