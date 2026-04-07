# Tailwind Visual Editor (TVE)

## Project Overview
A local development tool for visually editing Astro + Tailwind pages with **real source file sync**. Changes made in the visual editor are written directly to `.astro` source files using AST-based surgical edits (magic-string). The modified files are the actual project source — `astro build` produces a production build with all visual edits included.

Built as a pnpm monorepo with 4 packages. Supports Tailwind v3 (JS config) and v4 (CSS @theme).

## Architecture

```
packages/
├── shared/     → Types: ASTNode, Mutation, postMessage protocol
├── server/     → Express API + Astro dev server proxy + file watcher + config reader
├── injected/   → IIFE overlay: hover, selection, DOM-to-AST mapping
└── editor/     → React + Vite: tabbed properties panel, element tree, design system
```

### Key Design: Proxy + Base Tag

The iframe loads pages via `/preview/` which proxies to the Astro dev server. A `<base href="http://localhost:{astroPort}/">` tag is injected into the HTML so ALL sub-resources (Vite client, CSS modules, HMR WebSocket) resolve to the Astro dev server natively. The overlay script is injected as `<script src="{backendOrigin}/api/injected/injected.js">` with CORS headers.

### Source File Mutation Flow

1. User changes a property in the editor (e.g., font size dropdown)
2. Editor computes new class string and calls `applyMutation()`
3. Optimistic update: iframe element's className is updated instantly via postMessage
4. `POST /api/mutations/{filePath}` sends the mutation to the backend
5. Backend parses the `.astro` file with `@astrojs/compiler`, locates the element by nodeId
6. `magic-string` surgically overwrites the `class="..."` attribute at exact character offsets
7. File is saved to disk — preserving all formatting, comments, and whitespace
8. Astro HMR detects the change and hot-reloads the iframe preview
9. History store records the mutation + its inverse for undo/redo

## Running

```bash
# Terminal 1: Backend (pass path to an Astro project)
cd packages/server && npx tsx src/index.ts /path/to/astro-project

# Terminal 2: Editor frontend
cd packages/editor && npx vite
```

Open `http://localhost:3005`. Click "Start" to launch the Astro dev server, then select a page.

## Development Commands

```bash
pnpm install                        # Install all dependencies
pnpm --filter @tve/injected build   # Build the iframe overlay script
pnpm --filter @tve/editor build     # Build the editor frontend
```

**Note:** The backend runs via `tsx` (not `tsx watch`). Server code changes require a manual restart. The editor frontend hot-reloads via Vite automatically.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Delete` | Remove selected element |
| `Ctrl+D` | Duplicate selected element |
| `Ctrl+E` | Toggle add element panel |
| `Ctrl+Alt+G` | Wrap selected element in div |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |

## Implementation Status

### Phase 1: Foundation + Preview (Complete)
- pnpm monorepo with 4 packages (shared, server, injected, editor)
- Backend: Express server, AST parsing (@astrojs/compiler), file watcher (chokidar)
- Proxy: HTML injection with `<base>` tag for native Vite CSS/HMR support
- Injected script: hover highlights, click-to-select, postMessage bridge, DOM-to-AST mapping
- Editor: three-panel layout (react-resizable-panels), element tree, page selector
- Selection sync between element tree and iframe

### Phase 2: Visual Editing Controls (Complete)
- **Tabbed properties panel** — Style tab (colors, spacing, borders, effects), Layout tab (display, position, flex/grid, sizing, overflow), Text tab (font family/size/weight, alignment, line height, letter spacing, transform/decoration, content editor)
- **Smart class chips** — Each class chip is a dropdown showing related alternatives. `mt-4` opens all `mt-*` values, `bg-blue-600` opens all blue shades with color swatches, `md:grid-cols-3` opens all `md:grid-cols-*` options. Supports responsive prefixes (sm:, md:, lg:, xl:, 2xl:) and state variants (hover:, focus:, dark:)
- **Color controls** — Tailwind palette picker for text/bg/border using exact string matching (no regex corruption). 11 colors × 11 shades grid with visual swatches
- **Spacing controls** — Visual box-model editor for margin (orange) and padding (green), per-side dropdowns
- **Font family dropdown** — Reads custom font families from project's `tailwind.config.mjs`. Shows font-sans/serif/mono + custom families (font-heading, font-body, etc.)
- **Token suggestions** — Auto-suggests matching typography tokens when selecting elements (e.g., h1 → "Apply h1 token"). One-click applies size + weight + lineHeight. Color token quick-apply chips
- **Undo/redo** — History store (Zustand) with computed inverses, Ctrl+Z / Ctrl+Shift+Z
- **Iframe click-to-select** — Click elements in iframe preview to select and populate properties. DOM-to-AST mapping with component flattening
- **Preview mode** — Edit/Preview toggle hides panels for full-width clean preview
- **Device presets** — Desktop/Tablet (768px)/Mobile (375px) with CSS transition

### Phase 3: Structural Editing + Components (Complete)
- **Context menu** — Right-click tree nodes: add child/before/after, duplicate (Ctrl+D), delete (Del), wrap in div (Ctrl+Alt+G), extract to component
- **Add Element panel** — Searchable popover (Ctrl+E) with categorized HTML elements (Structure, Text, Media, Interactive, List, Astro slot/named slot) + project components. Click outside to close
- **Tree drag-and-drop** — @dnd-kit/core with grip handles, lenient drop zones (4px edge for before/after, rest defaults to "inside"), drag overlay, cycle prevention
- **New Component dialog** — `+ Component` toolbar button, creates `src/components/{Name}.astro` with Props interface skeleton
- **Extract to Component** — Context menu: extracts element HTML into new `.astro` file, adds import, replaces original with `<ComponentName />`
- **Component preview** — Generates `tve-preview.astro` page that imports and renders component in isolation
- **Double-click to enter** — Double-click component instances in tree to navigate into the component source
- **Slot support** — Empty components show a green dashed slot placeholder (with custom slot icon). Click or drop elements into it. Self-closing `<Component />` automatically converts to `<Component>...</Component>` when content is added
- **Components default expanded** — Component nodes show expand chevron and are expanded by default so the slot is visible
- **Green coloring** — Components and slot elements use green-500 styling to distinguish from regular HTML

### Phase 4: Design System + Theme (Complete)
- **@theme editor** — First tab in Design System panel. Define custom CSS variables organized by category:
  - Colors (`--color-brand` → `bg-brand`, `text-brand`)
  - Font Size (`--font-size-hero` → `text-hero`)
  - Font Family (`--font-family-heading` → `font-heading`)
  - Spacing (`--spacing-section` → `py-section`, `gap-section`)
  - Breakpoints (`--breakpoint-3xl` → `3xl:` responsive prefix)
  - Container/Max Width (`--container-narrow` → `max-w-narrow`)
  - Border Radius (`--radius-card` → `rounded-card`)
  - Shadows (`--shadow-card` → `shadow-card`)
  - Quick-add example buttons for common patterns
  - "Save to Tailwind Config" writes to `tailwind.config.mjs` (v3) or `@theme {}` CSS block (v4)
- **Tailwind version detection** — Auto-detects v3 (JS config) vs v4 (CSS @theme) by scanning for `@theme` or `@import "tailwindcss"` in CSS files
- **Design tokens** — Semantic tokens (primary, error, surface, etc.) synced to Tailwind config as real colors. `bg-primary`, `text-error` become usable classes. Add/remove custom tokens for colors, typography scale, spacing, radii, shadows
- **Colors tab** — Full default palette reference + custom color editor with native color pickers per shade, writes to config
- **Fonts tab** — Custom font family editor with popular font quick-picks (Inter, Playfair Display, etc.), live preview, Google Fonts `<link>` tag generator. Full type scale and font weight visual reference
- **Unified theme store** — `tailwind-defaults.ts` single source of truth, `theme-store.ts` loads project config and merges with defaults. All controls read from store
- **Token-aware properties** — Properties panel shows matching tokens with one-click apply

### Phase 5: UI Polish + Stability (Complete)
- **shadcn-inspired UI** — All panels darker (zinc-950), brighter labels (zinc-400 + font-medium), borderless flat design (no rounded corners), refined typography, custom select chevrons, focus rings
- **Tabbed properties panel** — Style/Layout/Text tabs with active blue indicator bar
- **Spacing controls** — Neutral box-model editor (no orange/green tints)
- **`tve` CLI launcher** — `npm start` or `node bin/tve.mjs <project-path>` with interactive prompt fallback to test project
- **File-writer hardening** — `validateElementRange()` validates AST positions before mutating, prevents corruption from off-by-one position errors
- **`update-classes` opening-tag-only search** — Regex limited to opening tag via `findOpenTagEnd()`, prevents matching child element class attributes
- **Iframe selection auto-expand** — Tree auto-expands parent nodes when descendant is selected, scrolls into view
- **Component DOM mapping** — Component nodeIds also map to first rendered DOM element for clickable component-rendered content

### Future
- Image handling, component prop editing
- Multi-file undo/redo for structural mutations
- Responsive class conflict warnings

## Key Technical Decisions

### Iframe Bridge: DOM Query vs Stored Ref
`sendToIframe()` finds the iframe via `document.querySelector('iframe[title="Page Preview"]')` on every call instead of storing a reference. Avoids stale refs when React re-creates the iframe element.

### AST Delivery: Dual Strategy
Injected script exposes `window.__tve_provideAst()` global. Editor uses both postMessage AND direct function call — bypasses message timing races for same-origin iframe.

### Path Security
All server routes use `resolveProjectPath()` from `lib/path-guard.ts` — centralized path traversal prevention. Mutation types validated against whitelist.

### Color Class Manipulation
Uses exact string matching via `parseClasses()` → `filter()` → `joinClasses()`. Regex `\b` word boundaries corrupt class strings because `-` is a boundary character.

### Component Flattening in DOM Mapper
Astro components (PascalCase tags) don't render as DOM elements. `DomMapper` detects and flattens them, matching their children against DOM elements directly.

### Tailwind Mobile-First
Controls follow Tailwind's mobile-first responsive system. Base classes = mobile, then `sm:`, `md:`, `lg:`, `xl:` prefixes override for larger screens.

## Key Files

| File | Purpose |
|------|---------|
| `packages/server/src/services/astro-parser.ts` | Parses .astro files into editor AST with nodeId assignment |
| `packages/server/src/services/file-writer.ts` | magic-string mutation engine for source file edits |
| `packages/server/src/services/tailwind-config.ts` | Reads/writes Tailwind config (v3 JS + v4 CSS @theme) |
| `packages/server/src/routes/dev-server.ts` | Proxy with `<base>` tag injection + CORS |
| `packages/server/src/routes/config.ts` | Theme + tokens API endpoints |
| `packages/server/src/routes/components.ts` | Component create/extract/preview endpoints |
| `packages/server/src/lib/path-guard.ts` | Path traversal security |
| `packages/injected/src/dom-mapper.ts` | DOM-to-AST matching with component flattening |
| `packages/editor/src/store/editor-store.ts` | Central Zustand store: selection, AST, mutations |
| `packages/editor/src/store/theme-store.ts` | Theme + tokens store, loads from project config |
| `packages/editor/src/store/history-store.ts` | Undo/redo stack with mutation inverses |
| `packages/editor/src/lib/tailwind-defaults.ts` | Single source of truth for default Tailwind values |
| `packages/editor/src/lib/class-utils.ts` | Tailwind class parsing/manipulation utilities |
| `packages/editor/src/lib/class-alternatives.ts` | Prefix-aware alternatives with responsive support |
| `packages/editor/src/lib/element-templates.ts` | HTML element templates for Add Element panel |
| `packages/editor/src/lib/iframe-bridge.ts` | postMessage bridge with dual AST delivery |
| `packages/editor/src/components/properties/` | Tabbed properties panel (Style/Layout/Text) |
| `packages/editor/src/components/properties/TokenSuggestions.tsx` | Token matching + one-click apply |
| `packages/editor/src/components/tree/` | Element tree with drag-drop, context menu |
| `packages/editor/src/components/design-system/` | Design System panel (@theme, colors, fonts, tokens) |
| `packages/editor/src/components/dialogs/` | Component create/extract dialogs |

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/project/info` | Project name and path |
| GET | `/api/files` | List .astro files |
| GET | `/api/files/*` | Read file content |
| GET | `/api/ast/*` | Parse file into editor AST |
| POST | `/api/mutations/*` | Apply mutation to source file |
| POST | `/api/dev-server/start` | Start Astro dev server |
| GET | `/api/dev-server/status` | Dev server status + URL |
| GET | `/api/config/theme` | Read Tailwind theme (v3 extend + v4 cssTheme) |
| POST | `/api/config/theme` | Write theme to config |
| GET | `/api/config/tokens` | Read design tokens |
| POST | `/api/config/tokens` | Save tokens (syncs colors to Tailwind config) |
| POST | `/api/components/create` | Create new .astro component |
| POST | `/api/components/extract` | Extract element to component |
| POST | `/api/components/preview` | Generate component preview page |

## Test Project

`test-project/` contains a sample Astro 5 + Tailwind v3 project for development testing. Requires `tailwind.config.mjs` with content paths.

## Port Assignments
- 3005: Editor (Vite dev server)
- 3001: Backend (Express API + proxy)
- 4321+: Astro dev server (auto-assigned, may increment if ports busy)
