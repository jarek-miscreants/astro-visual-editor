# Changelog

All notable changes to the Tailwind Visual Editor.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.

## [Unreleased]

### Added
- Schema-aware Properties panel for components — every prop from a `.astro` `interface Props { ... }` now renders with a typed control: numeric literal unions (e.g. `Cols = 1|2|...|12` referenced as `mobile?: Cols`) become a 1-to-N select via single-hop alias resolution; string unions stay as enum selects; primitives render as text/number inputs. Defaults extracted from `const { foo = "bar" } = Astro.props` are shown as placeholders or labelled options.
- JSDoc surfaced from `Props` member comments. Each prop label gets an info badge whose tooltip + ARIA label is the cleaned doc text — closes the gap between component documentation and the editor UI without a separate Storybook/MDX path.
- `ComponentSlotDef.hasFallback` returned by the slots service; paired `<slot name="x">fallback</slot>` declarations are now distinguishable from empty placeholders.
- `useComponentPropsStore` (mirror of the slots store): cache + `ensure / get / invalidate`. The existing `file:changed` watcher handler invalidates both stores on any `src/components/` change so renamed/added/removed props show up without a server restart.

### Changed
- `ComponentPropField` carries an optional `jsdoc?: string` on every variant; new `kind: "number-enum"` for numeric literal unions with `options: number[]`. `ComponentSlotDef` and `ComponentSlotSchema` moved into `@tve/shared` for cross-package use.
- `AttributesPanel` accepts a `schemaOwned: Set<string>` so component attrs the schema already covers no longer appear twice (typed control wins; raw editor stays as the escape hatch for unknown attrs).

## 2026-05-03

### Added
- Geist as the single editor font; replaced every monospace declaration with `var(--font-sans)` so the entire interface renders in Geist.
- `resolveTwColorRef()` resolver in `tailwind-config.ts` that maps token class refs (`blue-600`) to real hex values when syncing design tokens to Tailwind v3 configs.
- Vite client typings on the `@tve/injected` package so `import.meta.hot` typechecks cleanly.

### Fixed
- `.tve-prop-select` vertical centering — switched to `padding: 0 10px` + `line-height: 28px` so option text no longer clips inside the 28px control.
- Native dropdown colors — added `color-scheme: dark` and explicit `option` / `optgroup` styling so popups match the dark theme.
- Static page creation flow.
- Slot-content selection in the iframe.
- Component Props parser now tolerates indented frontmatter fences (`  ---`); previously the panel showed no fields for components whose authors indented their frontmatter.
- Tailwind v3 design-token sync now writes real hex values into `extend.colors` instead of class-name strings, so generated classes like `bg-primary` compile to valid CSS.
- Re-selection after structural mutations (`add-element`, `duplicate-element`, `wrap-element`) — the new node is selected and the iframe overlay tracks it, so the Properties panel populates immediately instead of going blank.
- Honest undo: `computeInverse` returns `null` for mutations without a recorded pre-state (`add-element`, `remove-element`, `duplicate-element`, `wrap-element`, `update-attribute`, `move-element` without AST). The editor skips recording these so undo no longer silently no-ops or replays the original change.
- Injected overlay now typechecks — added `tve:select-node` to the editor-to-iframe message union.
- `components.ts` routes hardened: every `path.join(projectPath, userInput)` and `relPath.includes("..")` site now flows through `resolveProjectPath()` plus a `validateAstroPath` extension check, restoring the documented path-guard contract.
- WebSocket handler leak in `editor-store.initProject()` — the registered `onWsMessage` unsubscribe is now captured and called on `resetProject` and on re-init (StrictMode double-invoke / project switch). `resetProject` also clears the history store so undo doesn't apply to a different project's state.
- API client now URL-encodes path segments for `getFileContent`, `getFileImports`, `getAst`, `applyMutation`, `readContentFile`, and `writeContentFile`, so files with `#`, `?`, `%`, or spaces no longer break routing.

### Changed
- Softened shell borders and elevated surfaces with translucent tones for depth.
- Properties panel's Advanced section defaults to **open** when a project component has an introspected Props schema, so every declared frontmatter prop is visible without an extra click.
- Port references in README, AGENTS.md, and CLAUDE.md corrected from `3001` → `3011` to match runtime; documented the `PORT` env override.

### Removed
- ~140 lines of dead code in `file-writer.ts` (`validateElementRange`, `VOID_ELEMENTS`, `findOpenTagEnd`, `findCloseTagStart`) — every call site already uses the imported `sourceRange.*` versions.

## 2026-05-02

### Added
- Child toolbar button, external-component picker, and iframe scroll memory.
- Named slots rendered as labelled drop targets in the element tree.
- Collection routing resolver.
- External-component inserts seeded with attributes from existing usages.

### Changed
- Properties panel reordered: classes-first, demoted tokens, lifted breadcrumb.
- Editor chrome styles extracted into themeable CSS variables.
- Component prop schema lookup now uses AST `tagName`.

### Fixed
- SVG selections no longer crash the injected overlay.
- File-writer corruption around self-closing components.
- `class` attribute no longer leaks outside the opening tag.
- Prop input staleness.
- Surfaced structured dev-server start errors.

## 2026-04-26 — 2026-04-27

### Added
- New content entry creation for `.md` / `.mdx` collections.
- Vitest harness with 136 tests across high-stakes modules.
- Link editor in marketer view with URL/Page mode toggle.
- Git integration with staging branch promotion.

### Changed
- Link picker pairs dynamic routes with content collections.

## 2026-04-20

### Fixed
- Force full reload on zustand store HMR to prevent split module state.
