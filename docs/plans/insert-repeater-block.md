# Insert repeater block (author a `.map()`-backed list from the editor)

Status: draft for review — not started.

Let a user scaffold a new repeater list from the editor — define its
fields, pick a layout, and TVE generates the frontmatter data array **and**
the `{items.map(...)}` markup that renders it, then the *existing* repeater
editor takes over for content. This is the authoring counterpart to the
already-shipped repeater **editor** (read/add/remove/reorder over an
existing array).

**Explicitly out of scope** (decided with the user):
- **Convert-to-repeater** — taking a hand-built card and "making it
  repeatable" by lifting literals into an array + rewriting them as
  bindings. The inference/tagging that needs is a separate, much larger
  effort and is not wanted.
- Per-instance inline editing of loop items (still edited via the panel).
- Generating a separate prop-driven component (data passed in as a prop
  array). v1 generates the list **inline** in the current file, because
  that's the exact shape the repeater editor already reads.

## The core principle

The repeater editor already round-trips `const X = [{…}]` + `{X.map(...)}`
safely. So "insert" only needs to **emit that same shape** and drop it into
the file; everything downstream (collapsible cards, field editing, add/
remove/reorder, the href link picker) works for free. The whole feature is
a **generator + a form + an insertion path** — not a new subsystem.

## Why this shape

- **The data layer is done.** `component-data.ts` reads/writes/reorders the
  array. Generated output that matches its expectations (top-level `const`
  of object literals, a `.map()` binding) is immediately editable.
- **The field-type palette already exists.** The `.tve.ts` control
  vocabulary (`text`, `textarea`, `image`, `link`, `choice`, `boolean`,
  `number`) is exactly what an authoring form needs — reuse it rather than
  invent a new type system.
- **Frontmatter + markup mutation has precedent.** `components/create` and
  `components/extract` already write `---` blocks and insert markup; the
  `add-element` mutation inserts elements at a chosen location. Insert-
  repeater combines those moves.

## Current-state facts this relies on

| Fact | Location |
|------|----------|
| Read/write/add/remove/reorder of frontmatter arrays | `packages/server/src/services/component-data.ts` |
| Array endpoints (data GET/POST, array-item add/remove/move) | `packages/server/src/routes/components.ts` |
| Repeater editor UI (cards, fields, link picker) | `packages/editor/src/components/properties/RepeaterPanel.tsx` |
| Field/control vocabulary | `ComponentPropMeta.control` in `packages/shared/src/types.ts`; parsed in `component-props.ts` |
| Element/component insertion at a target | `add-element` mutation in `file-writer.ts`; `AddElementPanel` |
| Frontmatter write precedent (imports, new `const`/blocks) | `routes/components.ts` (create/extract) |
| Markup templates for the Add panel | `packages/editor/src/lib/element-templates.ts` |

## Generation design

Input (from the authoring dialog):

```
{
  arrayName: "items",            // valid JS identifier, unique in the file
  itemVar: "item",               // .map() param
  layout: "card-grid",           // built-in template key
  fields: [
    { name: "title", type: "text" },
    { name: "body",  type: "textarea" },
    { name: "href",  type: "link" },
    { name: "image", type: "image" },
  ],
}
```

Output region 1 — frontmatter (one empty seed item so the loop renders a
single editable placeholder card, never blank-but-zero-items):

```ts
const items = [
  { title: "", body: "", href: "", image: "" },
];
```

Output region 2 — markup (a built-in layout template wrapping the loop):

```astro
<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
  {items.map((item) => (
    <article class="...card classes...">
      {item.image && <img src={item.image} alt="" class="..." />}
      <h3 class="...">{item.title}</h3>
      <p class="...">{item.body}</p>
      <a href={item.href} class="...">Learn more</a>
    </article>
  ))}
</div>
```

**Field → element mapping** (the generator's table):

| field type | rendered as |
|------------|-------------|
| text | `<h3>{item.x}</h3>` (first) / `<span>{item.x}</span>` |
| textarea | `<p>{item.x}</p>` |
| image | `<img src={item.x} alt="" />` |
| link | wrap the card or a CTA `<a href={item.x}>` |
| boolean | `{item.x && (…)}` conditional wrapper |
| number / choice | `<span>{item.x}</span>` |

Ship **2–3 built-in layout templates** (stacked list, card-grid, media-
grid) with starter Tailwind, rather than synthesizing layout from nothing —
that's what makes the result look like `FeatureGrid` instead of bare text.

## Phase A — Insert (the whole feature for this slice)

| # | Step | Files |
|---|------|-------|
| 1 | `generateRepeaterSource({arrayName, itemVar, layout, fields})` → `{ frontmatter: string, markup: string }`. Pure, unit-testable; encodes the mapping table + layout templates | new `packages/server/src/services/repeater-generator.ts` |
| 2 | A combined insert op: append the `const` array to the file's `---` block (create the block if absent) **and** insert the markup at a target (`parentNodeId` + position, reusing add-element's locator). One mutation so it's atomic/undoable | `file-writer.ts` (new `insert-repeater` mutation) or `routes/components.ts` |
| 3 | Identifier safety: validate `arrayName`/field names are valid JS idents and unique vs. existing frontmatter consts | generator + server guard |
| 4 | Authoring dialog: name + add fields (reuse the control palette) + layout picker; calls the insert op; on success selects the new block so the repeater editor opens | `packages/editor/src/components/dialogs/` (new), entry from AddElementPanel / a toolbar "Insert list" |
| 5 | Tests: generator output parses; round-trips through `readComponentArrays`; insert lands valid source | `repeater-generator.test.ts`, extend `component-data.test.ts` |

After Phase A, the existing repeater editor handles all content editing —
no extra work.

## Phase C — Schema editing (follow-up, optional)

Add/rename/remove a field *after* creation. The hard bit: it must touch
**both** regions — every array object **and** every `{item.field}` binding
in the template. Medium difficulty; layer on only if users ask. (Phase B,
convert-to-repeater, is intentionally omitted per scope above.)

## Risks / open decisions

1. **Template flexibility vs. simplicity.** Built-in layouts keep v1
   shippable but constrain the look. Users restyle via the normal class
   editor afterward (the generated cards are ordinary elements). Accept the
   constraint for v1.
2. **Where "Insert list" lives.** Natural homes: the Add Element panel (a
   "Dynamic list" category) or a toolbar action. Pick one; AddElementPanel
   is the more discoverable fit.
3. **Frontmatter without a `---` block.** Pages/components may lack
   frontmatter; the insert op must create one. Precedent exists in
   `extract`.
4. **Naming collisions** with existing consts/imports — validate up front,
   suggest a unique default (`items`, `items2`, …).

## Recommended first slice

Phase A end-to-end against the **card-grid** layout only (one template),
text/textarea/link/image field types. That reproduces the `FeatureGrid`
experience from a dialog and exercises the full generate → insert → edit
loop. Add more layouts and field types once the path is proven.
