# Inline editing of component-prop-bound content

Status: draft for review — not started.

Let the user double-click rendered content that comes from a component
**prop** and edit it at the prop's *definition site*, never clobbering
the `{prop}` usage inside the component. When the instance passes a
literal (`title="…"`) we edit the literal; when it passes a frontmatter
expression (`title={hero.data.title}`) we chase through to the real
source (a content-collection entry's frontmatter). The edit happens
**inline in the iframe** — no new properties-panel field.

Scope decisions (locked with the user):
- **Source:** component props bound to frontmatter only. Not arbitrary
  `{post.data.x}` in a page, not page-local `const` rewriting.
- **UX:** inline in the iframe (double-click). The existing
  `ComponentPropsPanel` already complements this from the side.

## The core principle

`<h1>{title}</h1>` lives in `MarketingHero.astro`. Overwriting it with a
literal would break **every** instance of the component and sever the
prop. So we never write into the component. Instead we resolve the
rendered text to the prop's definition site — the `title=…` on the
specific `<MarketingHero … />` instance in the parent page — and edit
that. This reuses the already-hardened `update-attribute` path and the
existing `component-props` introspection rather than inventing a
frontmatter-rewrite engine.

## Why this is the right shape

- **There is a live corruption bug to fix first.** A page that renders
  `<h1>{title}</h1>` parses to `textContent: null` with the expression
  silently dropped (`astro-parser.ts:86-89`). Double-click inline edit
  is wrongly *allowed* — the gate inspects only resolved DOM text
  (`interaction.ts:307-311`) — and `update-text` blindly overwrites the
  `{title}` binding with no guard (`file-writer.ts:82-103`). Class
  expressions and component-prop expressions are already protected with
  read-only chips; text is the one unguarded hole. Phase 0 closes it.
- **The write path already exists and is safe.** Editing a literal prop
  is `update-attribute` on the instance — already hardened this session
  (quote-escaping, attr-name validation, expression guard). Chasing to a
  collection entry reuses `content-files.ts` + `/api/content/write`
  (full gray-matter round-trip, already wired to `FrontmatterForm`).
- **The reverse mapping primitive already exists.** `link-targets.ts`
  (`getLinkTargets`) resolves entry → URL → source-file for the link
  picker; it inverts to answer "which entry is this preview showing."
- **Prop introspection already exists.** `component-props.ts` parses the
  `Props` interface via the TS compiler API and already detects
  expression-bound props.

## Current-state facts this plan relies on

| Fact | Location |
|------|----------|
| Expression *text* is dropped; `textContent` null; no source captured | `astro-parser.ts:86-89` |
| Expression *attributes/class* ARE captured as `"{…}"` strings | `astro-parser.ts:71-78`; `classExpression` |
| `update-text` has no expression guard (corrupts binding) | `file-writer.ts:82-103` |
| `update-classes` DOES guard `class={…}` (the pattern to mirror) | `file-writer.ts:59-68` |
| Inline-edit gate inspects only resolved DOM text | `interaction.ts:307-311`, dblclick `:171-230` |
| `tve:text-edit` → `update-text` mutation | `IframeCanvas.tsx:72-78` |
| Component subtree flattens onto the single instance node | `dom-mapper.ts` (component flattening) |
| Expression props shown read-only in panel ("edit in source") | `ComponentPropsPanel.tsx:345-389` |
| Entry → URL → source-file reverse linkage | `link-targets.ts:91-193` |
| Content-file frontmatter read/write (gray-matter) | `content-files.ts:134-163`; `/api/content/*` |

## Phase 0 — Safety net (ship regardless; fixes the corruption bug)

| # | Step | Files |
|---|------|-------|
| 1 | Add `isTextDynamic: boolean` + `textExpression: string` to `ASTNode`; stop dropping a single `expression` child — store its raw `{…}` source via `innerContentRange` | `packages/shared/src/types.ts`, `packages/server/src/services/astro-parser.ts` |
| 2 | Guard `update-text`: refuse when the inner range is an expression (mirror the `update-classes` guard) + regression test | `packages/server/src/services/file-writer.ts`, `file-writer.test.ts` |
| 3 | Thread `isTextDynamic` through `ASTNodeLike`; refuse inline edit on dynamic text in the dblclick gate | `packages/injected/src/dom-mapper.ts`, `packages/injected/src/interaction.ts` |
| 4 | Surface prop/expression-bound text read-only with a "bound — edit where used" affordance (mirror the expression-prop chip) | `packages/editor/src/components/properties/PropertiesPanel.tsx` |

## Phase 1 — Map rendered descendant → prop name

The enabler. The DOM mapper flattens a whole component subtree onto one
instance node; we need finer resolution (which rendered element → which
prop).

| # | Step | Files |
|---|------|-------|
| 1 | Content-binding map: parse a component `.astro` and emit, for each rendered text/attribute that is a *bare* prop reference (`{title}`, `{eyebrow}`, `{title ?? "…"}`), a stable locator (tag + ordinal path) → prop name. Simple references only; complex expressions excluded | `packages/server/src/services/component-props.ts` (extend) or new `component-content-map.ts` |
| 2 | On double-click inside a flattened instance, resolve `(instanceNodeId, propName)` using the binding map + DOM position | `packages/injected/src/dom-mapper.ts`, `packages/injected/src/interaction.ts` |

## Phase 2 — Inline edit writes the literal prop at the call site

| # | Step | Files |
|---|------|-------|
| 1 | Double-click prop-bound text → contentEditable → on commit emit `update-attribute` on the **instance** node (`attr=propName, value=newText`) | `packages/injected/src/interaction.ts`, `packages/editor/src/components/canvas/IframeCanvas.tsx` |
| 2 | Optimistic update is indirect (change is in the parent → HMR re-render). Patch the instance attribute optimistically; let HMR reconcile | `packages/editor/src/store/editor-store.ts` |

This alone makes the test-project `MarketingHero` eyebrow/title/
description editable by clicking them — the common case — and reuses the
existing safe `update-attribute` write.

## Phase 3 — Chase props bound to frontmatter ("from frontmatter")

When the instance value is an expression (`title={hero.data.title}`):

| # | Step | Files |
|---|------|-------|
| 1 | Static-analyze the page `---` block (reuse the TS-compiler approach in `component-props.ts`) to resolve the data root: `getEntry/getCollection('blog', slug)` | `packages/server/src/services/` (new frontmatter-resolver) |
| 2 | Invert `link-targets.ts`'s entry→URL mapping against the live preview URL → concrete `.md` entry + field | `packages/server/src/services/link-targets.ts` (reuse) |
| 3 | Write the field via the existing content path; HMR re-renders | `packages/server/src/services/content-files.ts`, `/api/content/write` (reuse) |
| 4 | Anything not statically resolvable (ternaries, computed values, local `const`) falls back to Phase 0 read-only "edit in source" | — |

Page-local `const` rewriting is explicitly out of scope for this slice.

## Risks / open decisions

1. **Preview context.** Inline prop editing needs the component rendered
   *within its parent page* — that's where the call site lives. In
   standalone component preview (`tve-preview.astro`) there's no single
   call site (props are sample data). Detect context and only offer
   inline prop-editing in page view; in component view fall back to
   Phase 0 read-only. (The test-project index renders `MarketingHero`
   in-place, so the common path is covered.)
2. **Multiple instances** with different prop values resolve correctly
   because the dom-mapper already maps to a specific instance node; the
   binding map only needs DOM-position disambiguation within it.
3. **Scope guard:** only bare-prop bindings are editable; complex
   expressions stay read-only. Keeps us out of arbitrary-JS-rewrite
   territory.

## Recommended first slice

**Phase 0 + Phase 2 against literal props.** Self-contained and
shippable: it fixes the corruption bug *and* makes clicking the hero's
eyebrow/title/description edit the real values — no frontmatter static
analysis yet. Phase 1's binding map is the bulk of the work; Phase 3
(the collection chase) layers on after. Phase 0 is a strict prerequisite
and also a bug fix, so start there.
