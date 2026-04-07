export interface ElementTemplate {
  tag: string;
  label: string;
  defaultClasses?: string;
  defaultContent?: string;
  defaultAttributes?: Record<string, string>;
  /** For compound elements like ul>li */
  innerHtml?: string;
}

export interface TemplateGroup {
  label: string;
  templates: ElementTemplate[];
}

export const ELEMENT_TEMPLATES: TemplateGroup[] = [
  {
    label: "Structure",
    templates: [
      { tag: "div", label: "Div" },
      { tag: "section", label: "Section" },
      { tag: "header", label: "Header" },
      { tag: "footer", label: "Footer" },
      { tag: "nav", label: "Nav" },
      { tag: "main", label: "Main" },
      { tag: "article", label: "Article" },
      { tag: "aside", label: "Aside" },
    ],
  },
  {
    label: "Text",
    templates: [
      { tag: "h1", label: "Heading 1", defaultClasses: "text-4xl font-bold", defaultContent: "Heading" },
      { tag: "h2", label: "Heading 2", defaultClasses: "text-3xl font-bold", defaultContent: "Heading" },
      { tag: "h3", label: "Heading 3", defaultClasses: "text-2xl font-semibold", defaultContent: "Heading" },
      { tag: "h4", label: "Heading 4", defaultClasses: "text-xl font-semibold", defaultContent: "Heading" },
      { tag: "h5", label: "Heading 5", defaultClasses: "text-lg font-medium", defaultContent: "Heading" },
      { tag: "h6", label: "Heading 6", defaultClasses: "text-base font-medium", defaultContent: "Heading" },
      { tag: "p", label: "Paragraph", defaultContent: "Paragraph text" },
      { tag: "span", label: "Span", defaultContent: "Inline text" },
      { tag: "a", label: "Link", defaultClasses: "text-blue-600 hover:underline", defaultContent: "Link text", defaultAttributes: { href: "#" } },
      { tag: "blockquote", label: "Blockquote", defaultClasses: "border-l-4 border-gray-300 pl-4 italic", defaultContent: "Quote text" },
    ],
  },
  {
    label: "Media",
    templates: [
      { tag: "img", label: "Image", defaultClasses: "max-w-full h-auto", defaultAttributes: { src: "https://placehold.co/600x400", alt: "Image" } },
    ],
  },
  {
    label: "Interactive",
    templates: [
      { tag: "button", label: "Button", defaultClasses: "px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 transition-colors", defaultContent: "Button" },
      { tag: "input", label: "Input", defaultClasses: "border border-gray-300 px-3 py-2 outline-none focus:border-blue-500", defaultAttributes: { type: "text", placeholder: "Enter text..." } },
      { tag: "textarea", label: "Textarea", defaultClasses: "border border-gray-300 px-3 py-2 outline-none focus:border-blue-500", defaultContent: "" },
      { tag: "form", label: "Form" },
    ],
  },
  {
    label: "List",
    templates: [
      { tag: "ul", label: "Unordered List", defaultClasses: "list-disc pl-5 space-y-1", innerHtml: "\n    <li>Item 1</li>\n    <li>Item 2</li>\n    <li>Item 3</li>\n  " },
      { tag: "ol", label: "Ordered List", defaultClasses: "list-decimal pl-5 space-y-1", innerHtml: "\n    <li>Item 1</li>\n    <li>Item 2</li>\n    <li>Item 3</li>\n  " },
    ],
  },
  {
    label: "Astro",
    templates: [
      { tag: "slot", label: "Slot (default)", defaultContent: "" },
      { tag: "slot", label: "Named Slot", defaultAttributes: { name: "header" }, defaultContent: "" },
    ],
  },
];

/** Generate HTML string from a template */
export function templateToHtml(template: ElementTemplate): string {
  const attrs: string[] = [];
  if (template.defaultClasses) {
    attrs.push(`class="${template.defaultClasses}"`);
  }
  if (template.defaultAttributes) {
    for (const [key, value] of Object.entries(template.defaultAttributes)) {
      attrs.push(`${key}="${value}"`);
    }
  }

  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

  // Self-closing tags
  if (["img", "input", "br", "hr", "slot"].includes(template.tag)) {
    return `<${template.tag}${attrStr} />`;
  }

  const content = template.innerHtml ?? template.defaultContent ?? "";
  return `<${template.tag}${attrStr}>${content}</${template.tag}>`;
}
