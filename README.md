# Tailwind Visual Editor

A local visual editor for **Astro + Tailwind** projects. Edit your pages visually — change classes, add elements, build components — and changes are written directly to your `.astro` source files. Run `astro build` and your production build includes everything you edited.

![Editor Screenshot](https://placehold.co/800x400/27272a/a1a1aa?text=Tailwind+Visual+Editor)

## Features

- **Real source file sync** — Changes write to `.astro` files via AST-based surgical edits, preserving formatting
- **Visual controls** — Spacing box-model, colors, typography, layout (flex/grid), borders, effects
- **Smart class chips** — Click any class chip to see all related alternatives (e.g., click `mt-4` to see all `mt-*` values, including `md:` responsive variants)
- **Tabbed properties panel** — Style / Layout / Text tabs for quick navigation
- **Element tree** — Drag-and-drop to reorder, right-click for context menu actions
- **Component system** — Create new components, extract elements to components, double-click to enter, slot support with droppable placeholders
- **Design system editor** — Define `@theme` variables (colors, fonts, spacing, breakpoints) that write to your Tailwind config
- **Design tokens** — Semantic tokens (primary, error, etc.) sync to `tailwind.config.mjs`
- **Tailwind v3 + v4 support** — Auto-detects which version you're using
- **Undo/redo** — Full history with Ctrl+Z / Ctrl+Shift+Z
- **Device preview** — Desktop / Tablet (768px) / Mobile (375px) preview modes
- **Component-aware** — Astro components are flattened in the DOM mapper, double-click to navigate into them

## Requirements

- **Node.js** 18 or later
- **pnpm** (the editor uses pnpm workspaces)
- An existing **Astro + Tailwind project** to edit

## Installation

```bash
git clone https://github.com/jarek-miscreants/astro-visual-editor.git
cd astro-visual-editor
pnpm install
```

That's it — no global installation needed.

## Usage

### Quick start (interactive)

From the editor's root directory:

```bash
npm start
```

You'll be prompted for the path to your Astro project. Press Enter to use the bundled `test-project/`, or type the absolute path to your own project:

```
Tailwind Visual Editor

  Enter path to your Astro project, or press Enter for test project.

  Project path [E:\path\to\test-project]: C:\my-website
```

### With a specific project (one command)

```bash
npm start -- "C:\my-website"
```

Or directly:

```bash
node bin/tve.mjs "C:\my-website"
```

This starts the backend server, the editor frontend, and prints URLs:

```
╔══════════════════════════════════════╗
║  Tailwind Visual Editor              ║
╚══════════════════════════════════════╝

  Project: C:\my-website
  Editor:  http://localhost:3005
  Backend: http://localhost:3011
```

Open **http://localhost:3005** in your browser, click **Start** in the top-left to launch your project's Astro dev server, and begin editing.

### Stopping

Press `Ctrl+C` in the terminal — both servers shut down cleanly.

## How it works

When you start the editor pointing at your Astro project:

1. **Backend** spawns your project's `astro dev` and proxies it via `/preview/`
2. **Editor** loads pages from the proxy in an iframe, with an overlay script for selection/hover
3. **Click any element** in the iframe → properties panel populates with controls
4. **Edit a property** → editor computes new class string → backend uses `magic-string` to surgically rewrite the `.astro` source file
5. **Astro HMR** picks up the change → iframe hot-reloads
6. **Your source files are updated** — `git diff` shows exactly what changed

The editor never modifies anything outside your project directory. All path operations are validated against directory traversal.

## Project structure expectations

The editor works best with standard Astro structure:

```
your-project/
├── astro.config.mjs
├── tailwind.config.mjs        # or .ts, .js, .cjs (Tailwind v3)
├── src/
│   ├── pages/                  # Your routes
│   ├── components/             # Astro components
│   └── layouts/                # Layouts
└── package.json
```

For **Tailwind v4** (CSS-based config), the editor looks for `@theme { }` blocks in your CSS files.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Click` element in iframe or tree | Select element |
| `Right-click` tree node | Context menu |
| `Double-click` component instance | Open component file |
| `Delete` | Remove selected element |
| `Ctrl+D` | Duplicate selected element |
| `Ctrl+E` | Open Add Element panel |
| `Ctrl+Alt+G` | Wrap selected element in `<div>` |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Escape` | Close menus / deselect |

## Toolbar overview

- **Project name** — Shows the current project
- **Start / Running** — Astro dev server control
- **Page selector** — Switch between pages, layouts, components
- **Undo / Redo** — Mutation history
- **+ Component** — Create a new Astro component from scratch
- **Design** — Open the Design System panel (theme editor, tokens, fonts, colors)
- **Edit / Preview** — Toggle property panels for clean preview
- **Device preset** — Desktop / Tablet / Mobile responsive preview

## Design System panel

Click the **Design** button in the toolbar to open the Design System editor. Five tabs:

1. **@theme** — Define custom CSS variables that map to Tailwind utilities (e.g., `--color-brand` → `bg-brand`, `--font-size-hero` → `text-hero`, `--breakpoint-3xl` → `3xl:` responsive prefix)
2. **Colors** — Visual reference of default Tailwind palette + custom color editor with native color pickers per shade
3. **Fonts** — Custom font family editor with popular Google Fonts quick-picks, live preview, auto-generated `<link>` tag
4. **Spacing** — Visual reference of default Tailwind spacing scale
5. **Tokens** — Semantic tokens (primary, secondary, error, etc.) that sync to `tailwind.config.mjs`

Click **Save to Tailwind Config** to write changes to `tailwind.config.mjs` (v3) or `@theme {}` CSS block (v4).

## Working with components

### Create a component
Click **+ Component** in the toolbar → enter PascalCase name → editor creates `src/components/{Name}.astro` with a typed Props interface and opens it for editing.

### Extract an element to a component
Right-click any element in the tree → **Extract to component** → enter a name. The element's HTML is moved to a new `.astro` file, the original is replaced with `<ComponentName />`, and the import is added to the page's frontmatter.

### Add slots
When building a component, add a `<slot />` element from the **Astro** category in the Add Element panel. Components with slots show a green dashed placeholder in the tree where you can drop content.

### Use slots
Self-closing component instances like `<Card />` show a slot placeholder underneath in the tree. Click the placeholder or drag an element onto it — the editor automatically converts `<Card />` to `<Card>...</Card>`.

## Architecture

This is a **pnpm monorepo** with 4 packages:

- `packages/editor` — React + Vite editor UI (port 3005)
- `packages/server` — Express backend with `.astro` parser, file writer, dev server proxy (port 3011)
- `packages/injected` — IIFE script injected into the iframe for hover/select
- `packages/shared` — Shared TypeScript types

See [CLAUDE.md](./CLAUDE.md) for technical implementation details.

## Troubleshooting

**Editor won't start** — Make sure ports 3011 and 3005 are free, or kill existing instances.

**"Dev server not running"** — Click the **Start** button in the toolbar to spawn `astro dev` in your project.

**Changes not appearing in preview** — The Astro dev server should hot-reload on file changes. If not, check that the file was actually written (look at `git diff` in your project).

**Properties panel resets classes** — This was a bug in earlier versions. If you see it, restart the backend (`Ctrl+C` in the terminal, then re-run `npm start`).

**Iframe shows "Vite client failed to connect"** — Your Astro dev server may have failed to start. Check the terminal output for errors.

## License

MIT
