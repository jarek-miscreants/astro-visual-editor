# Tailwind Visual Editor — State of the Build

Snapshot of what's working today. Updated 2026-04-26.

For architectural context and design decisions, see [`CLAUDE.md`](../CLAUDE.md). For the git integration design rationale, see [`docs/plans/git-integration.md`](plans/git-integration.md).

## Quick start

```bash
# Terminal 1 — backend (port 3011)
cd packages/server && npx tsx src/index.ts /path/to/your/astro/project

# Terminal 2 — editor frontend (port 3005)
cd packages/editor && npx vite
```

Open http://localhost:3005. The toolbar's project name is clickable to switch to a different Astro project. Click **Start** to launch the project's Astro dev server, then pick a page from the **Select page** dropdown.

If no project path is passed on launch, the editor opens to a project picker where you can paste a path or pick from recent projects.

## What's working today

### Editing surfaces

- **Element tree** (left sidebar) with drag-and-drop, search, context menu (add child / before / after, duplicate, delete, wrap-in-div, extract-to-component), keyboard shortcuts (Del, Ctrl+D, Ctrl+E, Ctrl+Alt+G).
- **Iframe canvas** (center) with live HMR via the project's actual Astro dev server. Click any element to select. Hover highlights. Edit/Preview mode toggle. Desktop / Tablet (768px) / Mobile (375px) device presets.
- **Properties panel** (right sidebar) — three modes:
  - **Dev mode** — full Tailwind class editor with smart class chips (mt-4 → all mt-* values, bg-blue-600 → all blue shades, md:grid-cols-3 → all md:grid-cols-* options), supports responsive prefixes (sm:, md:, lg:, xl:, 2xl:) and state variants (hover:, focus:, dark:). Tabbed: Style / Layout / Text. Token suggestions. Component-level typed props panel.
  - **Marketer mode** — content-focused editing only. See [Marketer mode](#marketer-mode) below.
- **Toolbar** — project switcher, dev/marketer toggle, dev server control, page selector, git widget, undo/redo (Ctrl+Z / Ctrl+Shift+Z), New Component button, Design System button, edit/preview toggle, device presets, keyboard shortcuts dialog (`?`).

### Marketer mode

Activated by clicking **Marketer** in the top-left segment toggle. Constrains editing to copy and props only — no class editing, no structural mutations. Designed for non-technical users.

- **Content-only sidebar.** Properties panel shows:
  - For raw text elements (`h1`, `p`, `span`, etc.): a textarea bound to the element's text content.
  - For Astro components: typed prop fields grouped into **Content** (prose-named props), **Link** (href-style props), and **Advanced** (collapsed by default). Slot-content editor for components with text-leaf children.
- **Link editor** (new) — for raw `<a>` tags and component link props (`href`, `url`, `link`, `to`, `cta_url`, `cta_href`):
  - **URL / Page toggle** above the input. URL mode = free-form text input. Page mode = dropdown of all project pages.
  - **Page dropdown groups:**
    - **Pages** — every static `src/pages/**/*.astro` rendered as its served URL
    - **{Collection}** sections — dynamic routes (`src/pages/blog/[slug].astro`) paired with content collections (`src/content/blog/`) generate one URL per entry
    - **Templates** — catch-alls and unmatched dynamic routes shown as disabled entries with a "use URL mode" hint
  - **Open in new tab** checkbox — pairs `target="_blank"` with `rel="noopener noreferrer"`. Hidden for components that don't declare a `target` prop (since setting it wouldn't propagate).
  - **External-URL test button** — opens the link in a new tab for verification.
  - **Auto-detects mode** — if the current href matches a known page URL, dropdown defaults to Page mode.

### Tree (left sidebar)

- Drag-and-drop reordering with grip handles, "before / after / inside" drop zones, drag overlay, cycle prevention.
- Right-click context menu: Add child, before, after, Duplicate, Delete, Wrap in div, Extract to component.
- Component instances show a green dashed slot placeholder when empty. Click or drop content into the slot.
- Components default to expanded so the slot is visible.
- Double-click a component instance to navigate into its source file.
- Keyboard shortcuts: `Del` / `Ctrl+D` / `Ctrl+E` / `Ctrl+Alt+G`.
- Marketer mode shows a "Blocks" view, scoped to top-level components and editable text.

### Design System panel

Opened from the toolbar **Design** button. Tabs:

- **@theme editor** — define custom CSS variables organized by category (colors, font size, font family, spacing, breakpoints, container width, border radius, shadows). "Save to Tailwind Config" writes to `tailwind.config.mjs` (v3) or `@theme {}` CSS block (v4).
- **Colors** — full default palette reference + custom color editor with native color pickers per shade.
- **Fonts** — custom font family editor with popular font quick-picks (Inter, Playfair, etc.), live preview, Google Fonts `<link>` tag generator. Type scale and font weight reference.
- **Tokens** — semantic tokens (primary, error, surface) synced to Tailwind config as real classes.

Tailwind v3 (JS config) and v4 (CSS @theme) both supported.

### Component creation + extraction

- **+ Component** toolbar button — creates `src/components/{Name}.astro` with a Props interface skeleton.
- **Extract to component** context menu — extracts the selected element's HTML into a new `.astro` file, adds an import, replaces the original with `<ComponentName />`.
- **Component preview** — generates a `tve-preview.astro` page that renders the component in isolation.
- **Typed prop editor** — reads the component's `Props` interface and exposes enum, boolean, string, and number props as proper controls (dropdowns, checkboxes, inputs, sliders).

### Git integration

Local-first git workflow. Hidden when the project isn't a git repo.

- **Toolbar widget** — branch chip, dirty-file count badge, ahead-count badge, "no remote" warning. Hover for full status tooltip. Click to open the git panel.
- **Git panel** (modal) shows:
  - **Branch switcher** dropdown — pinned ordering (production first, staging second, current third, others alpha). PROD / STAGING pills. Refuses to switch when working tree is dirty.
  - **Promote action row:**
    - **Set up staging** button — visible only when a staging branch doesn't exist yet. Auto-provisions `staging` from the production branch (resolved from `origin/HEAD`, falls back to `main`/`master`), pushes with `--set-upstream` so Cloudflare Pages picks it up.
    - **Send to Staging** — merges current branch into staging, pushes. Disabled when on staging or production.
    - **Publish to Production** — merges staging (or current branch if no staging) into production, pushes. Disabled when on production.
  - **Sync row** — ahead / behind / changes count with **Pull** and **Push** buttons.
  - **Changes** column — file-by-file list with icons (modified / added / deleted / new). Click to expand inline diff with red `-` / green `+` / blue hunk-header coloring.
  - **Commit** input — textarea + button. Stages all dirty files and commits.
  - **Recent commits** column — last 20 commits with short hash, subject, author, timestamp.
- **Force-merge prompt** — when a fast-forward merge isn't possible (branches diverged), a modal explains the situation and offers a merge-commit fallback.
- **Auto-refresh** — git status refreshes after every visual edit (debounced 500ms), after file watcher events, and after commit / push / pull / promote.

#### Git workflow today

The "intended" three-branch flow:

```
tve/draft-{slug}    →    staging    →    main
   (working)             (review)        (live)
        ↑                    ↑                ↑
   Save Draft         Send to Staging     Publish
```

You can use that, but:
- The "draft" step is currently manual (`git checkout -b feature/whatever` in your terminal). The in-app **New Draft** button isn't built yet.
- There's no first-connect dialog for staging setup. The staging button appears in the panel when needed.
- Cloudflare Pages auto-builds staging and main on push regardless of TVE — TVE doesn't yet show the deploy status badge inside the editor.

#### Operating modes (auto-detected)

| Mode | Trigger | Git widget | Push/pull |
|------|---------|------------|-----------|
| **No-git** | Project isn't a git repo | Hidden | N/A |
| **Local-only** | Repo exists, no remote configured | Visible with amber "local only" indicator | Disabled with tooltip |
| **Connected** | Repo + remote | Full | Full |

### Astro features

- **AST parsing** via `@astrojs/compiler` — preserves all formatting, comments, whitespace.
- **Mutation engine** uses `magic-string` for surgical edits at exact character offsets.
- **File watcher** (chokidar) detects external file changes mid-session and updates the editor without losing user state.
- **HMR-compatible** — saves go to disk, Vite picks them up, iframe reloads automatically.
- **Tailwind v3 + v4** both detected and supported.
- **Component flattening** in DOM mapper handles `PascalCase` Astro components correctly during click-to-select.
- **Class expression bindings** (e.g. `class={classes}`) are detected and rendered read-only with a clear explanation, preventing accidental clobbering.

### Content collections

- **Markdown / MDX editor** — for `.md`/`.mdx` files in `src/content/`. Frontmatter editor (typed fields) + body editor (visual markdown via @mdxeditor/editor).
- Collection auto-detection — files under `src/content/{collection}/` are recognized and listed in the page selector.

## How to use it

### For a developer

1. Launch the editor pointing at your Astro project.
2. Click **Start** to boot the dev server.
3. Pick a page. The iframe shows the rendered HTML.
4. Click elements in the iframe (or tree) to select them.
5. Edit classes via the Tailwind class editor on the right. Changes write to disk immediately. Iframe HMR shows the result in <100ms.
6. Use **Undo** (`Ctrl+Z`) liberally — every mutation is reversible via git-aware undo.
7. Commit your work via the git widget in the toolbar.

### For a marketer

1. Switch to **Marketer** mode (top-left segment toggle).
2. The tree becomes a "Blocks" view scoped to editable content.
3. Click any element to edit its content / props in the right panel.
4. For buttons and links: enter a URL or pick a page from the dropdown.
5. Don't worry about classes, layout, or component structure — those are read-only here.
6. When done, open the git panel, write a commit message, click **Commit**, then **Send to Staging**. Staging builds automatically on Cloudflare Pages.
7. Verify staging looks right at `staging.{site}.pages.dev`. When ready, click **Publish to Production**.

### For setting up a new project

1. Open the project in TVE (point the backend at it on launch).
2. If it's a git repo with no `staging` branch, click the **Set up staging** button in the git panel. TVE creates the branch from `main` and pushes to origin.
3. Configure Cloudflare Pages to deploy:
   - Production branch: `main`
   - Preview branches: All non-production branches (or specifically `staging`)
4. After the first push to staging, your preview URL will be `staging.{site-name}.pages.dev` (or whatever pattern CF assigns).

## What's not built yet

### Git layer

- **In-app draft creation** — no "New Draft" button; users currently `git checkout -b` themselves.
- **First-connect setup dialog** — no welcome flow for fresh repos. Staging setup is reactive (button in panel).
- **GitHub auth + PR creation** — push works over SSH or with credential helpers; HTTPS push requires a credential helper or PAT in the system git config. No "Open PR" button.
- **`.tve/config.json` editor UI** — config file is read/written by the backend but no UI to edit branch role names.
- **Cloudflare Pages deploy status badges** — push works but the editor doesn't show "building / live" state. Integration would need a CF API token entry in project settings.
- **Branch protection detection** — pushing to a protected `main` will return the raw error toast. No fallback to PR creation.
- **Conflict resolution UI** — merge conflicts surface as error toasts. User has to resolve in their editor and commit manually.
- **Auto-fetch from origin** — TVE doesn't periodically `git fetch`; `behind` count only updates after manual pull or restart.

### Editor

- **Image handling** — no image upload, no `<img>` src picker, no integration with Astro's image optimization.
- **Component prop schema beyond TS interfaces** — `.tve.ts` schema files for richer marketer-prop definitions aren't supported yet.
- **Multi-file structural undo** — undo works per-file. Component extraction (which writes to two files) doesn't roll back atomically.
- **Responsive class conflict warnings** — no detection of conflicting `md:grid-cols-3` + `lg:grid-cols-2` setups.
- **Custom slug detection in collection pages** — uses filename slugs only; frontmatter `slug` overrides aren't followed.
- **Multi-param dynamic routes** — `pages/[lang]/[slug].astro` is skipped to "Templates" group.
- **Catch-all routes** (`[...rest].astro`) — listed as templates with no entries.

### Hosted / SaaS

Out of scope for the current build. See [`docs/plans/git-integration.md`](plans/git-integration.md) for the long-term plan.

## File map (key files for developers)

### Backend (`packages/server/`)

| Path | What it does |
|------|--------------|
| `src/index.ts` | Express + WebSocket entry; mounts all routes |
| `src/routes/git.ts` | Git API endpoints (status, commit, push, branches, promote, ensure-staging, …) |
| `src/services/git.ts` | `simple-git` wrapper with promotion + provisioning logic |
| `src/services/astro-parser.ts` | `.astro` → editor AST with stable nodeIds |
| `src/services/file-writer.ts` | `magic-string` mutation engine for surgical edits |
| `src/services/tailwind-config.ts` | Reads/writes Tailwind config (v3 JS + v4 CSS @theme) |
| `src/services/file-watcher.ts` | chokidar; broadcasts `file:changed` over WS |
| `src/services/astro-dev-server.ts` | Spawns + manages the project's Astro dev server |
| `src/routes/dev-server.ts` | Proxy with `<base>` tag injection + CORS for HMR |
| `src/routes/components.ts` | Component create / extract / preview |
| `src/routes/config.ts` | Theme + tokens API |
| `src/lib/path-guard.ts` | Path traversal security |

### Frontend (`packages/editor/`)

| Path | What it does |
|------|--------------|
| `src/store/editor-store.ts` | Central Zustand store: selection, AST, mutations, project lifecycle |
| `src/store/git-store.ts` | Git state: status, branches, diff, commits, promotion actions |
| `src/store/theme-store.ts` | Theme + tokens, project config loader |
| `src/store/history-store.ts` | Undo/redo stack with mutation inverses |
| `src/store/content-store.ts` | Markdown content files |
| `src/store/mode-store.ts` | Dev / marketer mode |
| `src/store/toast-store.ts` | Toaster system |
| `src/store/tree-ui-store.ts` | Tree expansion, search, marketer zoom |
| `src/lib/api-client.ts` | Typed API surface for backend routes |
| `src/lib/iframe-bridge.ts` | postMessage bridge with dual AST delivery |
| `src/lib/class-utils.ts` | Tailwind class parsing/manipulation |
| `src/lib/class-alternatives.ts` | Prefix-aware alternatives |
| `src/lib/element-templates.ts` | HTML element templates for Add Element panel |
| `src/components/layout/Toolbar.tsx` | Top toolbar — project, mode, dev server, page selector, git widget, undo/redo |
| `src/components/git/GitToolbarWidget.tsx` | Toolbar branch chip + dirty count |
| `src/components/git/GitPanelDialog.tsx` | Modal: branch switcher, promote actions, sync row, changes, commits |
| `src/components/properties/PropertiesPanel.tsx` | Right sidebar — Dev/Marketer split |
| `src/components/properties/LinkSection.tsx` | URL/Page toggle, page dropdown with collection grouping, new-tab toggle |
| `src/components/properties/ComponentPropsPanel.tsx` | Typed component prop editor (Content / Link / Advanced groups) |
| `src/components/properties/TailwindClassEditor.tsx` | Smart class chips |
| `src/components/properties/StyleTab.tsx` / `LayoutTab.tsx` / `TextTab.tsx` | Property tabs |
| `src/components/properties/TokenSuggestions.tsx` | Token matching + one-click apply |
| `src/components/tree/` | Element tree, drag-drop, context menu |
| `src/components/design-system/DesignSystemPanel.tsx` | Theme / colors / fonts / tokens |
| `src/components/dialogs/` | Component create / extract / project picker |
| `src/components/markdown/MarkdownEditor.tsx` | MDX content editor |
| `src/components/canvas/IframeCanvas.tsx` | Iframe + overlay |
| `src/components/page-selector/PageSelector.tsx` | File picker dropdown |

### Injected overlay (`packages/injected/`)

Built once with `pnpm --filter @tve/injected build`. Loaded into the iframe via `<script src="…/injected.js">`.

| Path | What it does |
|------|--------------|
| `src/index.ts` | Hover, click-to-select, postMessage bridge, AST sync |
| `src/dom-mapper.ts` | DOM ↔ AST mapping with component flattening |

### Shared (`packages/shared/`)

| Path | What it does |
|------|--------------|
| `src/types.ts` | All TS types: ASTNode, Mutation, GitStatus, TveBranchConfig, etc. |
| `src/protocol.ts` | postMessage + WebSocket protocol types |

## Ports

- **3005** — Editor (Vite dev server)
- **3011** — Backend (Express API + Astro dev server proxy)
- **4321+** — Astro dev server (auto-assigned by Astro, may increment)

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `?` | Show shortcuts dialog |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` | Remove selected element |
| `Ctrl+D` | Duplicate selected element |
| `Ctrl+E` | Toggle Add Element panel (dev mode) |
| `Ctrl+Alt+G` | Wrap selected element in div (dev mode) |

## Tests

```bash
pnpm test              # whole repo (server + editor)
pnpm --filter @tve/server test         # server only
pnpm --filter @tve/server test:watch   # watch mode
```

Vitest covers the high-stakes modules: 136 tests across 8 files. Coverage focus:

- **`server/src/lib/path-guard.test.ts`** (15 tests) — path traversal security, sibling-prefix attacks
- **`server/src/services/astro-parser.test.ts`** (9 tests) — element + component parsing, JSX class expression detection, source positions, nodeId stability
- **`server/src/services/file-writer.test.ts`** (12 tests) — every mutation type with fixture .astro files. Catches the opening-tag-only regression, refuses to overwrite JSX expression bindings.
- **`server/src/services/git.test.ts`** (20 tests) — real-git in tmpdirs. Mode detection, status, commit, ensureStaging idempotency, promote FF + non-FF + conflict abort + structured error codes
- **`server/src/services/tailwind-config.test.ts`** (13 tests) — v3 vs v4 detection, theme read/write, CSS @theme block edits, design-tokens sync
- **`editor/src/lib/class-utils.test.ts`** (33 tests) — Tailwind class parse / join / replace / toggle
- **`editor/src/lib/class-alternatives.test.ts`** (16 tests) — alternatives generation including responsive prefixes
- **`editor/src/store/history-store.test.ts`** (18 tests) — `computeInverse` per mutation type, undo/redo state machine

Real-git tests spawn fresh repos via `git init` in tmpdir per test (~50-200ms each). Acceptable for a focused suite. Editor tests are sub-second.

## Known issues

- **`tsc -b` editor build fails** on 18 pre-existing `import.meta.hot` errors in store files. The actual `vite build` succeeds and `vite dev` works fine. Fix is a tsconfig adjustment (add `vite/client` to `types`); deferred since it doesn't block development.
- **Windows CRLF warnings** on git add. Cosmetic — git stores LF on the remote and converts on checkout. Set `core.autocrlf` if it bothers you.
- **`packages/editor/tsconfig.tsbuildinfo`** appears as an untracked file. It's a TypeScript incremental-build cache; should probably be added to `.gitignore` but is currently just left alone.
