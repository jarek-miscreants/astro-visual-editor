import type {
  RepeaterFieldSpec,
  RepeaterFieldType,
  RepeaterLayout,
} from "@tve/shared";

/**
 * Generates the two source regions for an authored repeater block:
 *  - `constBlock`: a `const <arrayName> = [{…}]` array (one empty seed item) for
 *    the component frontmatter.
 *  - `markup`: `{<arrayName>.map((<itemVar>) => (…))}` wrapped in a built-in
 *    layout, with each field rendered by type.
 *
 * The output matches the shape the repeater *editor* already reads, so once
 * inserted the user can add/remove/reorder items and edit fields with no
 * further work. Pure + deterministic so it's unit-testable.
 */

export interface GenerateRepeaterInput {
  arrayName: string;
  itemVar: string;
  layout: RepeaterLayout;
  fields: RepeaterFieldSpec[];
}

export interface GeneratedRepeater {
  constBlock: string;
  markup: string;
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
// JS reserved-ish words we don't want as an array/item identifier.
const RESERVED = new Set([
  "const", "let", "var", "function", "return", "class", "if", "else", "for",
  "while", "do", "new", "delete", "typeof", "instanceof", "in", "of", "this",
  "super", "import", "export", "default", "null", "true", "false", "void",
  "Astro", "Fragment",
]);

export function isValidIdentifier(name: string): boolean {
  return IDENT_RE.test(name) && !RESERVED.has(name);
}

/** Validate an authoring request; returns an error message or null. */
export function validateRepeaterInput(input: GenerateRepeaterInput): string | null {
  if (!isValidIdentifier(input.arrayName)) {
    return `"${input.arrayName}" is not a valid array name.`;
  }
  if (!isValidIdentifier(input.itemVar)) {
    return `"${input.itemVar}" is not a valid item variable name.`;
  }
  if (input.itemVar === input.arrayName) {
    return "The item variable must differ from the array name.";
  }
  if (input.fields.length === 0) {
    return "Add at least one field.";
  }
  const seen = new Set<string>();
  for (const field of input.fields) {
    if (!isValidIdentifier(field.name)) {
      return `"${field.name}" is not a valid field name.`;
    }
    if (seen.has(field.name)) {
      return `Duplicate field "${field.name}".`;
    }
    seen.add(field.name);
  }
  return null;
}

/** The empty seed literal for a field type. */
function emptyLiteral(type: RepeaterFieldType): string {
  if (type === "boolean") return "false";
  if (type === "number") return "0";
  return '""';
}

/** Build the frontmatter `const <name> = [ { … } ];` with one empty item. */
function buildConstBlock(input: GenerateRepeaterInput): string {
  const props = input.fields
    .map((f) => `    ${f.name}: ${emptyLiteral(f.type)},`)
    .join("\n");
  return `const ${input.arrayName} = [\n  {\n${props}\n  },\n];`;
}

/** Tailwind classes per layout, kept here so templates stay consistent. */
const LAYOUT_CLASSES: Record<RepeaterLayout, { wrapper: string; item: string }> = {
  "card-grid": {
    wrapper: "grid gap-6 sm:grid-cols-2 lg:grid-cols-3",
    item: "flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-6",
  },
  "stacked-list": {
    wrapper: "flex flex-col gap-4",
    item: "flex flex-col gap-2 border-b border-slate-200 pb-4",
  },
};

/** Render a single field as JSX, given the item variable. `isHeading` promotes
 *  the first text field to an <h3>. */
function renderField(
  field: RepeaterFieldSpec,
  itemVar: string,
  isHeading: boolean
): string {
  const ref = `${itemVar}.${field.name}`;
  switch (field.type) {
    case "image":
      return `{${ref} && <img src={${ref}} alt="" class="w-full rounded-md object-cover" />}`;
    case "link":
      return `<a href={${ref}} class="inline-flex text-sm font-semibold text-blue-600 hover:text-blue-500">Learn more</a>`;
    case "boolean":
      return `{${ref} && <span class="text-xs font-semibold uppercase tracking-wide text-blue-600">${field.name}</span>}`;
    case "number":
      return `<span class="text-sm text-slate-600">{${ref}}</span>`;
    case "textarea":
      return `<p class="text-sm leading-6 text-slate-600">{${ref}}</p>`;
    case "text":
    default:
      return isHeading
        ? `<h3 class="text-xl font-semibold text-slate-950">{${ref}}</h3>`
        : `<p class="text-sm text-slate-700">{${ref}}</p>`;
  }
}

/** Render a single field's JSX binding (no heading promotion) — used when
 *  adding a field to an existing repeater's card template. */
export function renderFieldBinding(
  field: RepeaterFieldSpec,
  itemVar: string
): string {
  return renderField(field, itemVar, false);
}

/** Build the `{arrayName.map((itemVar) => (<item>…</item>))}` markup. Fields are
 *  grouped: media (images) first, then text/number/boolean content, then links. */
function buildMarkup(input: GenerateRepeaterInput): string {
  const { arrayName, itemVar, layout, fields } = input;
  const cls = LAYOUT_CLASSES[layout] ?? LAYOUT_CLASSES["card-grid"];

  const media = fields.filter((f) => f.type === "image");
  const links = fields.filter((f) => f.type === "link");
  const content = fields.filter(
    (f) => f.type !== "image" && f.type !== "link"
  );
  // First text field becomes the heading.
  const headingName = content.find((f) => f.type === "text")?.name;

  const lines: string[] = [];
  for (const f of media) {
    lines.push(`        ${renderField(f, itemVar, false)}`);
  }
  if (content.length > 0) {
    lines.push(`        <div class="flex flex-col gap-2">`);
    for (const f of content) {
      lines.push(`          ${renderField(f, itemVar, f.name === headingName)}`);
    }
    lines.push(`        </div>`);
  }
  for (const f of links) {
    lines.push(`        ${renderField(f, itemVar, false)}`);
  }

  return [
    `<div class="${cls.wrapper}">`,
    `  {${arrayName}.map((${itemVar}) => (`,
    `    <article class="${cls.item}">`,
    ...lines,
    `    </article>`,
    `  ))}`,
    `</div>`,
  ].join("\n");
}

export function generateRepeaterSource(
  input: GenerateRepeaterInput
): GeneratedRepeater {
  return {
    constBlock: buildConstBlock(input),
    markup: buildMarkup(input),
  };
}
