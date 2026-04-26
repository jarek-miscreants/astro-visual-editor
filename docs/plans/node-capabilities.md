# Plan: Per-node capabilities with refusal reasons

**Status:** proposed
**Created:** 2026-04-21
**Origin:** Distilled from an LLM code review of an unrelated Astro editor prototype. Most findings were already solved in TVE; this one is the only genuinely new idea.

## Problem

TVE's `ASTNode` has `isDynamic` and `classExpression` as implicit signals that a node is "not normal," but there is no structured answer to *"what can I do with this node, and if I can't do X, why not?"* The editor UI treats every selected node as fully editable, then silently fails or corrupts source when a mutation targets something it shouldn't (a `{...}` expression, a component's internals, a slot placeholder).

This matters most in **marketer mode**, whose purpose is to let non-developers edit safely without breaking things they don't understand. Today, marketer mode is implemented as branching logic inside individual UI components. A capabilities layer consolidates those decisions into the parser where the context exists to make them correctly.

## What TVE already has (and this plan does not duplicate)

- AST-based source mutation (`magic-string` surgical edits)
- Dev-server bridge (proxy + base tag + postMessage overlay)
- Insert, duplicate, delete, wrap, move operations
- Undo/redo with computed inverses
- Tailwind-aware editing (no inline-style bias)
- Tree with collapse, drag-and-drop, component boundaries
- Correct `path-guard.ts` (`startsWith(root + path.sep)` with exact-match escape)
- React-escaped UI (no `innerHTML` / `srcdoc` interpolation in editor)
- Marketer/dev mode split (behavioral, not yet capability-driven)

## Proposal

Add a `NodeCapabilities` structure computed by the parser, enforced by the server, and surfaced by the editor UI.

## Milestone 1 — Capabilities type (foundation)

### Shared type

Add to `packages/shared/src/types.ts`:

```ts
export interface NodeCapabilities {
  canEditText: boolean;
  canEditClasses: boolean;
  canEditAttributes: boolean;
  canReorder: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canInsertChildren: boolean;
  /** If any of the above are false, a short human-readable reason. */
  readOnlyReason?: string;
}

export interface ASTNode {
  // ...existing fields
  capabilities: NodeCapabilities;
}
```

### Parser computation

Populate in `packages/server/src/services/astro-parser.ts` — the parser has the context the editor doesn't (is this inside `{...}`, is this a named slot, is this a directive-driven node).

Base rules:

| Condition | Effect | `readOnlyReason` |
|---|---|---|
| `isDynamic: true` | all false | "Inside a `{...}` expression — edit the source expression instead." |
| `classExpression` present | `canEditClasses: false` | "Classes are bound to a `{...}` expression." |
| Node is inside an imported component's rendered subtree (not its instance) | text/classes/attributes false | "This content lives in `Foo.astro`. Open that file to edit." |
| Named slot placeholder | `canEditText: false`, `canInsertChildren: true` | "Slot — drop content here." |
| `set:html` or `is:raw` directive | `canEditText: false` | "Content is rendered as raw HTML from an expression." |
| Normal static element | all true | — |

Marketer-mode overlay (narrower):

| Condition | Effect | Reason |
|---|---|---|
| Element is a container (no direct text) | `canEditText: false` | "This is a container — select the text inside." |
| Element has no user-visible text and no image attrs | `canEditClasses: false` | (Don't expose Tailwind edits to marketers for structural elements.) |

### Server enforcement

`packages/server/src/routes/mutations.ts` must reject mutations that violate capabilities (403 with `readOnlyReason`). The server currently trusts whatever the editor sends — fine today, risky if marketer mode ever sits behind a less-trusted frontend.

## Milestone 2 — Surface in UI

### Properties panel (`packages/editor/src/components/properties/`)

When a control is disabled by capabilities: grey it out, show `readOnlyReason` as a tooltip or inline note.

**Do not silently hide controls.** Invisible means "feature doesn't exist." Greyed-with-reason means "you can't do this *here*, here's why." The distinction is load-bearing for user trust.

### Tree (`packages/editor/src/components/tree/`)

- Small lock icon next to nodes where `canEditText && canEditClasses && canReorder` are all false.
- Hover shows `readOnlyReason`.
- Drag sources with `canReorder: false` — not draggable.
- Drop targets with `canInsertChildren: false` — reject drops with a visible reason.

### Refusal toast

When a disallowed action is attempted via keyboard shortcut (e.g. `Delete` on a locked node), show a toast with the reason rather than silently doing nothing. Toast infrastructure already exists (commit `484a6bc`).

## Milestone 3 — Marketer mode uses this

Today marketer mode is about *showing* content editors for raw text children. The capabilities layer makes it *enforced*: marketer mode flips a global flag, the parser computes stricter capabilities, every part of the UI that respects capabilities Just Works. No separate marketer-specific branches in each component. Most of M3 should be net deletion of conditional branches.

## Deliberately out of scope

- **Full document manifest** (`sourceId/filePath/componentName/slotName/ownership`). TVE already carries most of this implicitly via `nodeId` + file routing. Promoting it to an explicit manifest is a refactor without a concrete UX that needs it. Revisit when a third or fourth feature wants ownership info.
- **Staged-changes panel.** Real value, real work. Its own milestone after this lands. Optimistic writes + undo/redo cover most of the "feel safe" surface already.
- **Test suite.** TVE has no tests today. Adding unit tests for path-guard, reorder, and capabilities is clearly good but it's an infrastructure call (runner, layout, CI) — a separate conversation.

## Sequencing

1. **M1** is small: ~1 change in `shared/types.ts`, ~1 in `astro-parser.ts` to populate, ~1 in the mutations route to enforce. One commit. Ship first; M2/M3 depend on it.
2. **M2** is incremental UI polish. Properties panel enforcement → tree icons → refusal toasts, in that order.
3. **M3** is largely a cleanup pass: collapse marketer-specific branches into capability checks driven by a mode flag in the parser.
