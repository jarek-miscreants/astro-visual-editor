# Changelog

All notable changes to the Tailwind Visual Editor.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.

## [Unreleased]

### Added — `<style>` / `<script>` raw content editing (2026-05-31)
- **`update-raw-content` mutation** — edit the inner text of a component's `<style>` and `<script>` blocks from inside TVE (Dev mode only). A single surgical-range mutation overwrites only the body between the opening tag's `>` and the closing tag; attributes and directives (`is:global`, `is:inline`, `define:vars={…}`, `lang`) are preserved byte-for-byte. Inverse restores the previous content for undo/redo. (`packages/shared/src/types.ts`, `packages/server/src/services/file-writer.ts`, `source-range.ts` `innerContentRange()`, `astro-parser.ts` `rawTextContent`, `routes/mutations.ts`.)
- **`RawContentEditor` panel** — selecting a `<style>`/`<script>` node shows a code editor (save on blur / Ctrl+S, external-change refresh) instead of the Style/Layout/Text tabs. Marketer mode shows a read-only note, never the editor. (`packages/editor/src/components/properties/RawContentEditor.tsx`, `PropertiesPanel.tsx`, `editor-store.ts`, `history-store.ts`.)
- **Tests** — `source-range` + `file-writer-raw-content` server suites and `history-store` inverse cases.

### Fixed (2026-05-31)
- **Component prop placement was value-dependent** — the same prop landed in the "Content" section on one component instance and a generic "Properties" bucket on another, depending on its current value (e.g. a `header` of "98.3% uptime" matched a prose heuristic via its `.`, while "Enterprise security" did not — so only one CardIcon in a row showed an editable Header field). Classification is now schema-only (prop name + declared default), so every instance of a component renders identically; added `header`/`subheader`/`tagline`/`kicker` to the content-name list. (`packages/editor/src/components/properties/ComponentPropsPanel.tsx`.)

### Added — Phase 2 (GitHub auth, broker, clone+install, token-injecting git)
- **Token broker (Cloudflare Worker, `broker/`)** — out-of-band service that holds the GitHub App's client secret + private key. Routes: `GET /` health check, `POST /oauth/exchange` (OAuth code → user token), `POST /installations/:id/token` (App JWT → installation token). RS256 JWT signing in Web Crypto with PKCS#1 → PKCS#8 wrapper so GitHub Apps' default `.pem` works without manual openssl conversion. Allowed-origins gating for defense-in-depth. 44 unit tests covering all routes, malformed inputs, and GitHub error propagation. Deployed at `https://tve-broker.jarek-dbc.workers.dev` for the personal-test App.
- **Centralized GitHub App config (`packages/server/src/lib/github-app-config.ts`)** — env-driven loader for `GITHUB_APP_ID` / `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_SLUG` / `GITHUB_APP_BROKER_URL`. All-or-nothing on the public triple (partial throws). Slug + Client ID shape checks catch paste errors. Returns `null` when nothing's set so the CLI flow stays untouched. 10 unit tests.
- **`.env.example` + auto-loading** — `packages/server/.env.example` documents every server-side variable. `dev` and `start` scripts use Node's native `--env-file-if-exists=.env.local --env-file-if-exists=.env` (no `dotenv` dep). `.env.local` is gitignored.
- **`docs/integration/app-config.md`** — single source of truth for the App's public values + a runbook for the eventual swap to Miscreants ownership (transfer or re-register paths).
- **`state.db` invalidation guard (`StateStore.syncAppContext`)** — on boot, if `GITHUB_APP_ID` differs from the persisted `current_app_id`, drops `installations` + `repos` so stale installation IDs don't leak across an App swap. Preserves `prefs`, `recent_projects`, `github_account`. 4 new state-store tests.
- **OAuth flow (`packages/server/src/routes/auth.ts`)** — `GET /github/start` builds the authorize URL with CSRF state, `GET /github/callback` exchanges the code via the broker, stores the token. Token persistence to `state.db` survives `tsx watch` reloads. `GET /whoami` + `POST /logout` round out the surface. 17 route tests.
- **GitHub list routes (`packages/server/src/routes/github.ts`)** — `GET /api/github/installations` and `GET /api/github/installations/:id/repositories` proxy api.github.com using the stored user token. Normalized response shapes; 401 when not signed in. 10 route tests.
- **Frontend GitHub repo picker (`components/dialogs/GitHubRepoPickerDialog.tsx`)** — opened from the auth dropdown in the toolbar. Lists installations, drills into repos, click "Open" to clone. Auto-selects the only installation when there's just one (single-account UX). Inline progress state for the long clone+install path.
- **GitHub clone flow (`services/github-clone.ts`)** — `POST /api/project/switch` with `kind: "github"` mints an installation token via the broker, clones using `https://x-access-token:${token}@github.com/{owner}/{repo}.git`, then **immediately scrubs the token from `.git/config`** by rewriting the remote URL to the plain HTTPS form. The token never persists on disk. Records `installationId` in `.tve-meta.json` for the token transport to find.
- **Auto-install on clone (`services/dependency-installer.ts`)** — detects pnpm/yarn/npm from lockfile, runs install via Corepack (handles Windows PATH where pnpm/yarn aren't shimmed), captures stderr tail on failure, 5-minute timeout. Lockfile hash recorded in `.tve-meta.json` so re-opening the same repo skips install when the lockfile hasn't changed.
- **Token-injecting git transport (`createTokenGitTransport`)** — replaces the ambient pass-through when an App is configured. Per push/pull, mints a fresh installation token via the broker (cached in-memory by `installationId` with 60s safety margin before broker-reported expiry) and injects it as `git -c http.extraheader=Authorization: Basic …`. Token never written to `.git/config`, never reused after expiry. Falls back to ambient when the repo has no `installationId` recorded (local-only or pre-feature clones). 5 transport tests + 7 token-source tests, plus a debug log line per call so the path taken is observable.
- **AuthButton in the toolbar** — "Sign in" → opens GitHub OAuth in current tab; signed-in → avatar + login + dropdown with "Open repo from GitHub…" and "Sign out".
- **`useAuthStore` + `consumeSignedInQuery`** — Zustand store backing `AuthButton`; `consumeSignedInQuery` strips `?signed_in=1&user=…&installation_id=…` from the URL after the callback bounce so reloads don't re-trigger.

### Added — Phase 0 + Phase 1 (foundations)
- **Local-SaaS migration scaffolding (Phase 0)** — `TVE_MODE` env var (`cli` | `desktop`) gates desktop-only flows; surfaced on `app.locals.mode` and on `GET /api/project/info`. Companion plan docs (`local-saas-migration.md`, `phase-0-decisions.md`, `phase-1-plan.md`, `phase-2-plan.md`, `publish-flow-transition.md`, `git-integration.md`) lock in GitHub-App-via-broker auth, server-serves-built-editor packaging, same-origin preview iframe with editor-shell CSP, and `~/.tve/repos/{owner}/{repo}/` cache layout.
- **CI smoke job (`.github/workflows/cli-smoke.yml`)** — boots the server in `cli` mode against `test-project/`, parses one page, and asserts `200 OK`. Runs on `main` and `feat/local-saas`. Companion `scripts/cli-smoke.mjs` is the standalone harness.
- **Phase 1 step 5 — Git transport (`services/git-transport.ts`)** — Single seam (`push`/`pull`/`fetch`/`clone`) for every network git op. Phase 1 ships an ambient pass-through; Phase 2 swaps in token-injection. Six call sites in `git.ts` (raw `push`/`pull` + `ensureStaging` + `promote`) routed through `getGitTransport()`. 13 new unit tests verify pass-through and error propagation.
- **Phase 1 step 6 — Repo cache (`services/repo-cache.ts`)** — Filesystem layout + bookkeeping for cached repo clones (`{base}/{owner}/{repo}/.tve-meta.json`). `resolveBaseDir` honors override > `prefs.repos_base_dir` > default. SHA-256 lockfile hashing across `pnpm-lock.yaml` | `package-lock.json` | `yarn.lock` so `pnpm install` can be skipped when the lock hasn't changed. 19 unit tests; not wired into routes until Phase 2.
- **Phase 1 step 7 — Persistent state store (`services/state-store.ts` + `state-store-migrations.ts` + `tve-paths.ts`)** — SQLite (`better-sqlite3`) at `~/.tve/state.db` (overridable via `TVE_HOME`). Schema v1: `github_account`, `installations`, `repos` (with `fs_path`), `prefs`, `recent_projects`. One-shot import from `~/.tve-recent.json` (existing real path) or `~/.tve/recent-projects.json` (plan-anticipated). `recent-projects.ts` dual-writes JSON + SQLite in `cli` mode for backwards compatibility. 17 unit tests.
- **Phase 1 step 8 — Project switch typed payloads** — `ProjectSwitchPayload` discriminated union (`kind: "local" | "github"`) and `ProjectSwitchResponse` shipped in `@tve/shared`. `POST /api/project/switch` now accepts the legacy `{path}` shape, the new `{kind:"local",path}` shape, and the `{kind:"github",owner,repo,ref?}` shape (returns `501` with code `phase2-github` until Phase 2 wires the clone flow). 16 new route tests.
- Exit shortcut (`Ctrl+Shift+Q`) — confirms, then calls a new `POST /api/project/exit` endpoint that stops the Astro dev server and exits the backend. The CLI launcher now propagates child-process exits, so killing the backend tears down the editor Vite server too. Browser tab shows an "Editor stopped" overlay and best-effort `window.close()`.
- Schema-aware Properties panel for components — every prop from a `.astro` `interface Props { ... }` now renders with a typed control: numeric literal unions (e.g. `Cols = 1|2|...|12` referenced as `mobile?: Cols`) become a 1-to-N select via single-hop alias resolution; string unions stay as enum selects; primitives render as text/number inputs. Defaults extracted from `const { foo = "bar" } = Astro.props` are shown as placeholders or labelled options.
- JSDoc surfaced from `Props` member comments. Each prop label gets an info badge whose tooltip + ARIA label is the cleaned doc text — closes the gap between component documentation and the editor UI without a separate Storybook/MDX path.
- `ComponentSlotDef.hasFallback` returned by the slots service; paired `<slot name="x">fallback</slot>` declarations are now distinguishable from empty placeholders.
- `useComponentPropsStore` (mirror of the slots store): cache + `ensure / get / invalidate`. The existing `file:changed` watcher handler invalidates both stores on any `src/components/` change so renamed/added/removed props show up without a server restart.

### Changed
- **Git panel: `Push` button replaced with `Publish`** — single primary action that does commit (auto-message `Edits from TVE — {timestamp}` when working tree is dirty) + push in one click. Disabled only when the tree is clean *and* nothing is ahead of remote. Pull moves to dev-mode-only and only renders when `behind > 0`; marketer mode never sees raw git verbs.
- `ComponentPropField` carries an optional `jsdoc?: string` on every variant; new `kind: "number-enum"` for numeric literal unions with `options: number[]`. `ComponentSlotDef` and `ComponentSlotSchema` moved into `@tve/shared` for cross-package use.
- `AttributesPanel` accepts a `schemaOwned: Set<string>` so component attrs the schema already covers no longer appear twice (typed control wins; raw editor stays as the escape hatch for unknown attrs).
- `AGENTS.md` is now a thin pointer to `CLAUDE.md` so the two cannot drift.
- `ProjectSwitchPayload` `github` branch now requires `installationId: number` (the picker passes it from `selectedInstallationId`). Server uses it to mint installation tokens for clone + push.

### Fixed
- `mode-store.loadMode` no longer silently swallows TVE-config load failures — the `catch` now `console.warn`s with the underlying error so a misconfigured `tve.config` is visible in DevTools instead of falling back to "dev" mode without trace.

### Dependencies
- Added `better-sqlite3@^12.9.0` (Node-24 prebuilds) + `@types/better-sqlite3` to `@tve/server`. Root `package.json` declares `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` so the prebuild install hook runs reliably.
- New workspace package `broker/` (Cloudflare Worker). Devs deps: `wrangler`, `@cloudflare/workers-types`, `vitest`. No production runtime deps — uses `crypto.subtle` from the Workers runtime for RS256 signing.

### Security notes
- Tokens never persisted in `.git/config`: clone embeds the installation token in the URL but rewrites the origin remote immediately after; push uses `git -c http.extraheader=...` for single-invocation auth. Recorded for posterity in `docs/follow-ups.md`.
- Server transports never see the App's client secret or private key — those live exclusively in the Cloudflare Worker (set via `wrangler secret put` or the dashboard).

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
