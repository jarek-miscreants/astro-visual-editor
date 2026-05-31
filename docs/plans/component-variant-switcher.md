# Component Variant Switcher (Storybook-lite, display-only)

Status: draft for review — not started.

A small feature: when editing a component that has an enumerable prop
(e.g. `variant: "primary" | "secondary"`), show a switcher above the
preview to render the component as each value. **Display only** — no
per-variant editing. Editing continues to target the shared component
source exactly as today.

This is the deliberately-scoped stepping stone discussed alongside the
bigger "editable variant canvas" idea (see *Relation to the canvas
idea* below). It avoids all the hard parts (frontmatter TS-AST editing,
per-instance identity, class attribution) and ships the "see Primary vs
Secondary" value on its own.

## Scope

| # | Step | Files |
|---|------|-------|
| 1 | Expose enumerable prop values from the prop reader | `packages/server/src/services/component-props.ts` |
| 2 | Accept `props` on the preview endpoint and serialize into the render | `packages/server/src/routes/components.ts` |
| 3 | Switcher/controls UI above the component preview | `packages/editor/src/components/canvas/IframeCanvas.tsx` (+ a small `VariantControls` component), `packages/editor/src/lib/api-client.ts`, editor store |

## Guiding constraints

- **Display only.** No new editing surface; `applyMutation` is untouched.
- **Additive.** A component with no enumerable props behaves exactly as
  today (no switcher rendered). Passing a variant is strictly additive
  to the current `<Component />` (no-prop) render — it also fixes
  today's "always renders the undefined/base variant" behavior.
- **No new args system.** Reuse current rendering; only inject the
  selected enumerable-prop values. Slot/required-prop gaps are the same
  pre-existing limitation, not new scope (see Risks).

## Step 1 — Enumerable prop values

Extend the existing prop schema (`getComponentPropSchema`, already
consumed by the Props panel) so each prop optionally carries its
selectable values:

```ts
interface ComponentPropField {
  name: string;
  type: string;            // existing
  optional: boolean;       // existing
  // NEW: present when the prop is a string-literal union or boolean
  options?: (string | boolean)[];
}
```

- **String-literal union** (`"primary" | "secondary"`): parse the union
  members from the type text the reader already extracts.
- **Boolean**: `options: [true, false]`.
- Everything else: no `options` → not switchable.
- Fallback (optional, later): if no union prop exists but a
  `variantClasses` / `cva`-style record is present, offer its keys.

## Step 2 — Preview endpoint accepts props

`POST /api/components/preview` gains an optional `props`:

```
POST /api/components/preview
Body: { componentPath: string, props?: Record<string, string | number | boolean> }
```

Serialize `props` into the generated `tve-preview.astro` render tag:

```astro
<Button variant="secondary" />
```

- String → `name="value"`, boolean `true` → `name`, boolean `false` →
  omit, number → `name={n}`.
- Only primitive props are serialized; objects/arrays are ignored
  (out of scope for the switcher).
- The standalone-isolation render from the existing fix is unchanged —
  we only add attributes to the component tag.

## Step 3 — Switcher UI

- `api-client.ts`: `previewComponent(path, props?)` forwards `props`.
- Editor store: track selected enumerable-prop values per component
  (`Record<propName, value>`), reset on component change, defaulting to
  the first option.
- `IframeCanvas.tsx` (component-preview branch only): render a small
  `VariantControls` strip above the iframe — one dropdown (or segmented
  control for booleans) per prop that has `options`. On change, update
  the store and re-call `previewComponent(currentFile, selected)`; the
  iframe HMR-reloads with the new variant.
- No controls render when the component has zero enumerable props.

## Test plan

- `component-props.test.ts`: union prop → `options` populated; boolean →
  `[true,false]`; non-enumerable prop → no `options`.
- `routes` (components): `/preview` with `props` writes the expected
  `<Component …/>` tag; boolean `false` omitted; objects ignored.
- Editor: store resets selection on component switch; `previewComponent`
  called with the selected props.
- Manual: open `Button` in `test-project`/a fixture with a `variant`
  union → switcher lists the values → flipping it re-renders the
  isolated preview.

## Exit criteria

- [ ] Opening a component with a `variant` union shows a switcher; each
      value re-renders the isolated preview.
- [ ] Components without enumerable props show no switcher and behave
      exactly as before.
- [ ] Editing (classes/text/structure) still targets the component
      source unchanged.
- [ ] Server + editor typecheck clean; new unit tests pass.

## Risks / out of scope

- **Args for required props / slot content.** Components that need props
  or slot content to render meaningfully will still render empty/broken —
  the same limitation as today's no-prop preview. A proper args/fixtures
  system (default slot text, sample values) is a separate follow-up, not
  this feature.
- **Multiple variant dimensions.** Surfacing *all* enumerable props as
  controls is supported by the design (per-prop dropdowns); start with
  just `variant` if simpler.
- **Data-attribute-only variants** with no typed prop and no recognizable
  record aren't auto-detectable — out of scope.
- **No per-variant editing.** Explicitly excluded — that's the large
  feature below.

## Relation to the canvas idea

The full Webflow/Figma-style **editable** variant canvas (all variants at
once, each editable) is a much larger effort: it needs frontmatter
TS-AST editing, per-instance identity in a multi-render view, and
class-to-source attribution — two of which are shared with the
content-collection-display work. This switcher is the display-only
subset; the variant-detection (Step 1) and prop-serialization (Step 2)
it builds are reusable if that bigger feature is ever revisited.
