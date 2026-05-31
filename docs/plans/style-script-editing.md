# Editing `<style>` / `<script>` content in the component view

Status: draft for review — not started.

Let the user edit the raw content of a component's `<style>` and
`<script>` blocks from inside TVE (Dev mode only). This is a
text-range edit in the template body — TVE's existing strength — so it
needs no new architectural primitives (no frontmatter TS-AST, no
per-instance identity). It's "a raw-content editor panel + one new
mutation type."

## Why it's small

- **Already parsed.** The AST parser surfaces `<style>` and `<script>`
  as element nodes with source positions and their text content (they
  show up in the element tree today, e.g. on the Tabs component).
- **Mutation engine already does surgical range edits.** Classes/text
  are replaced via magic-string at exact offsets with recorded inverses
  for undo. Editing a style/script body is the same operation on the
  node's *inner* range.

## Scope

| # | Step | Files |
|---|------|-------|
| 1 | `update-raw-content` mutation (replace a node's inner range) | `packages/server/src/services/file-writer.ts`, `packages/shared/src/types.ts` |
| 2 | Inner-content range computation for style/script nodes | `packages/server/src/services/source-range.ts` (or astro-parser) |
| 3 | Code-editor panel for the selected style/script node | `packages/editor/src/components/properties/` (new `RawContentEditor`), `PropertiesPanel.tsx`, editor store, `lib/api-client.ts` |
| 4 | Dev-mode gating | `PropertiesPanel.tsx` (read `useModeStore().userMode`) |

## Guiding constraints

- **Dev mode only.** The panel is gated to `userMode === "dev"`;
  Marketer mode never exposes raw CSS/JS editing.
- **Text-only edit.** We replace the inner content of an existing
  style/script node. We do not add/remove style/script blocks, and we
  do not touch the node's attributes/directives (`is:global`,
  `define:vars`, `lang`) — they're preserved verbatim.
- **Reuse history.** The mutation flows through the existing history
  store; inverse = restore the previous content.

## Step 1 — `update-raw-content` mutation

```ts
// packages/shared/src/types.ts
{ type: "update-raw-content"; nodeId: string; content: string }
```

`file-writer.ts` resolves the node's inner range (step 2), validates it
(reuse `validateElementRange`-style guards), and `magic-string`
overwrites the inner range with `content`. Returns the inverse
(`update-raw-content` with the old inner text) like other mutations.

## Step 2 — Inner-content range

For a `<style>`/`<script>` node, compute the offsets *between* the
opening tag's `>` and the closing `</style>`/`</script>`. The node
already has element bounds; this is a small extension of
`source-range.ts` (or read content positions from the Astro compiler
output if available). Guard: refuse if the node is self-closing or the
inner range can't be resolved.

## Step 3 — Code-editor panel

- When the selected node is a `<style>` or `<script>`, `PropertiesPanel`
  renders `RawContentEditor` instead of the Style/Layout/Text tabs.
- Editor: CodeMirror with CSS/JS highlighting (textarea acceptable for a
  first cut). Loads the node's current content; Save (or debounce/blur)
  → `applyMutation({ type: "update-raw-content", nodeId, content })`.
- `api-client.ts` / store: the mutation path already exists; just route
  the new type through it.
- **Refresh on external change.** Re-read content when the file
  re-parses (`file:changed` already invalidates editor state) so manual
  / external edits don't get clobbered.

## Step 4 — Dev-mode gating

`RawContentEditor` only mounts when `userMode === "dev"`. In Marketer
mode a selected style/script node shows a read-only note (or nothing).

## Test plan

- `file-writer` test: `update-raw-content` replaces only the inner range
  (tags/attributes/`define:vars` preserved); inverse restores exactly;
  multiple style/script blocks edited independently.
- `source-range` test: inner-range computed correctly for `<style>`,
  `<script>`, `<style is:global>`, `<style define:vars={…}>`.
- Editor: panel shows for style/script selection in Dev mode, hidden in
  Marketer mode; save dispatches the mutation; undo/redo round-trips.
- Manual: edit a component's `<style>` → preview reflects it via HMR;
  edit `<script>` → reloads; malformed input surfaces via the existing
  dev-server preflight error, no corruption.

## Exit criteria

- [ ] Selecting a `<style>`/`<script>` node in Dev mode shows a code
      editor; saving rewrites only that block's content.
- [ ] Tags, attributes, and directives are preserved byte-for-byte
      outside the edited inner range.
- [ ] Undo/redo works; external edits refresh the panel.
- [ ] Marketer mode never exposes the editor.
- [ ] Server + editor typecheck clean; unit tests pass.

## Risks / out of scope

- **Invalid CSS/JS** can break the build — same risk as hand-editing.
  Surface via existing preflight; optional lightweight validate-on-save
  is a nice-to-have, not required.
- **Adding/removing** style/script blocks, and editing `define:vars`
  *values* in frontmatter, are out of scope (the latter is the separate
  frontmatter-editing problem).
- **Scoped-style semantics** need no special handling — Astro scopes the
  CSS; we only edit text.

## Reusable primitive

`update-raw-content` (replace a node's inner range) is generic — it can
later back a raw-text editor for any element whose content is plain text
(e.g. inline `<svg>`, `<pre>`), independent of this feature.
