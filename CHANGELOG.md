# Changelog

All notable changes to the Tailwind Visual Editor.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.

## [Unreleased]

## 2026-05-03

### Added
- Geist as the single editor font; replaced every monospace declaration with `var(--font-sans)` so the entire interface renders in Geist.

### Fixed
- `.tve-prop-select` vertical centering — switched to `padding: 0 10px` + `line-height: 28px` so option text no longer clips inside the 28px control.
- Native dropdown colors — added `color-scheme: dark` and explicit `option` / `optgroup` styling so popups match the dark theme.
- Static page creation flow.
- Slot-content selection in the iframe.

### Changed
- Softened shell borders and elevated surfaces with translucent tones for depth.

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
