# Phase 0 — Locked decisions

Companion to `migration-plan.md` Phase 0, step 2. Resolves the three plan
blockers flagged in `local-saas-migration.md` so Phases 1–4 have firm
ground to build on. Each decision is locked but reversible — note any
new findings here before reopening one.

## 1. GitHub App secret strategy → **Option C: hosted token broker**

The Electron app and the local TVE server **must not** ship the GitHub
App's client secret or private key. A small hosted broker (single
Cloudflare Worker / Lambda / equivalent) handles every secret-backed
exchange:

- OAuth code → user access token exchange;
- installation-token minting (per-call, short-lived);
- nothing else — no repo content, no proxying, no caching of tokens
  beyond response lifetime.

**Why over Option A (ship secrets) / Option B (per-user GitHub App).**
A is unsafe — secrets in a desktop binary are extractable. B has
unacceptable UX (every user registers their own App). C contains the
secret on infrastructure we control while keeping every other byte of
user code and content on the user's machine.

**Device flow as fallback.** If the broker is unreachable, TVE falls
back to GitHub device flow (no client secret required). This also
covers air-gapped / locked-down environments.

**Scope of the broker.** Phase 2, step 9. Lives in its own repo,
out-of-band from `main`. Documented in this repo via App ID +
permissions only.

## 2. Editor packaging model → **server serves built editor (same origin)**

In production (Electron), `packages/server` static-serves
`packages/editor/dist/` at `/`. The Electron `BrowserWindow` loads
`http://localhost:{tvePort}/`. `/api`, `/preview`, and `/ws` stay
same-origin with the editor shell.

**Why over a `file://` or custom-protocol renderer with configurable
API base URL.** The current editor frontend assumes same-origin `/api`,
WebSocket on `/ws`, and `/preview/*` for the proxied dev server.
Keeping that invariant in production means zero code changes in the
editor for desktop, no CORS surface, and the existing browser dev
workflow on `pnpm dev` keeps working unchanged.

**Implication for Phase 3.** The editor is just a static bundle the
server serves at `/`; that invariant holds regardless of how the server
is packaged (see decision 2a).

## 2a. Server runtime in production → **run on Electron's bundled Node (`utilityProcess.fork`), NOT a Node SEA binary**

*Decided 2026-06-09.* Electron is the **only** delivery path — there is
no plan to ship TVE as a hosted web app or a standalone headless server
CLI. (Complexity and market traction don't justify a web build.) That
removes the sole justification for compiling `packages/server` into a
standalone Node SEA single-binary: the only consumer is the Electron
shell, and Electron already ships a full Node runtime.

So in production the server is **esbuild-bundled to a single JS file**
and run by Electron via `utilityProcess.fork()` (or a forked child on
Electron's Node). The renderer still loads `http://localhost:{tvePort}/`
exactly as decision 2 specifies.

**Why over the SEA binary (the earlier draft assumption).**
- No second Node runtime shipped — the SEA path would embed a whole
  Node inside the app *in addition to* Electron's, inflating size for no
  benefit when Electron is the only host.
- Drops the entire SEA toolchain: no `postject`, no per-OS Node binary,
  no embedded-WASM-via-`sea.getAsset` step, no native `.node` sidecar
  vendoring as a packaging concern.
- Native modules (`better-sqlite3`, `keytar`) are rebuilt against
  Electron's Node ABI via `electron-rebuild` / `@electron/rebuild` —
  routine, and the keychain decision already keeps `keytar` in the
  Electron main process anyway.

**Cost accepted.** We lose the "standalone `tve-server` CLI works
without Electron" side benefit. Given Electron-only delivery, that
artifact has no consumer, so it's not a loss in practice. The source
`tve <path>` CLI dev workflow (`tsx`) is unaffected — it never used the
binary.

**Implication for Phase 3.** Phase 3 shrinks to: esbuild-bundle the
server JS, keep the `/api/health` endpoint + boot ordering, and confirm
the server static-serves `editor/dist/`. The SEA / `postject` /
single-binary work (old Step 15a/15b/15d) is **dropped**.

## 3. Preview iframe isolation → **same origin, no `sandbox` attribute, tighter CSP on the editor shell**

The preview iframe loads from `/preview/*` on the same origin as the
editor. **No `sandbox` attribute** is added, and **no separate
localhost origin** is introduced for the preview.

**Why same origin.** TVE runs only repos the user themselves opened —
same trust model as `git clone && pnpm dev` in a terminal. A separate
preview origin would break the existing `<base href="http://localhost:
{astroPort}/">` injection trick (`packages/server/src/routes/dev-
server.ts`) that lets Vite client, CSS modules, and HMR resolve
natively. The cost (significant proxy/HMR rework) outweighs the
defensive benefit (none, given the trust model).

**Why no `sandbox` attribute.** A sandboxed iframe blocks the injected
overlay's `postMessage` bridge, the `window.__tve_provideAst()` direct
call, and Astro's HMR client — all of which the editor depends on.
Selectively re-allowing them via `sandbox="allow-scripts allow-same-
origin ..."` defeats the security benefit anyway.

**What we DO add.** A Content Security Policy on the editor shell
HTML (set in `packages/server/src/routes/dev-server.ts` HTML rewrite,
or a sibling middleware) restricting:

- `default-src 'self'`;
- `connect-src 'self' ws://localhost:* http://localhost:*` (for the
  Astro HMR WebSocket and proxied requests);
- `script-src 'self' 'unsafe-inline'` (Vite + HMR + the injected
  overlay need inline scripts in dev; tighten to `'self'` in
  production where the editor is the built bundle);
- `frame-src 'self'` so only same-origin previews can be embedded;
- no `object-src`, no `base-uri` outside `'self'`.

**Implication for Phase 4.** `webPreferences` on the Electron
`BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` (Electron renderer sandbox, distinct from the iframe
`sandbox` attribute). The renderer talks to the local server over
HTTP/WS just like the browser dev workflow does today.

**Reopen this decision if** the product grows a "browse community
templates" or "preview a shared snippet" feature where TVE renders
content the user did not themselves choose to open. At that point a
separate preview origin and a real iframe `sandbox` policy become
warranted.

## 4. Repos cache directory → **default `~/.tve/repos/`, inline per-clone override, sticky pref, no onboarding screen**

Cloned GitHub repos land at `{repos_base_dir}/{owner}/{repo}/`. The
base directory defaults to `~/.tve/repos/` and is user-configurable.
The state directory (`~/.tve/state.db`) is *not* configurable — it
stays under `~/.tve/` regardless. The two are decoupled because users
move project folders for disk-space reasons; they rarely move app
state.

**Resolution order** at clone time:

1. Explicit `destBase` argument on the clone API (Phase 2 step 12).
2. `prefs.repos_base_dir` from `state.db`.
3. Default `path.join(tveHome(), "repos")`.

### User flow — chosen: inline in the clone dialog

The clone dialog shows the resolved destination as a read-only string
with a `[Change…]` button next to it. Hitting Clone with the default
is one click; the override is one click + an OS folder picker.

```
┌───────────────────────────────────────────┐
│  Clone acme/marketing-site                │
│  Branch: main ▾                           │
│                                           │
│  Save to: ~/.tve/repos/acme/marketing-... │
│           [ Change… ]                     │
│                                           │
│  [ Cancel ]              [ Clone ]        │
└───────────────────────────────────────────┘
```

**Why over an onboarding screen** ("Welcome — where would you like to
keep your projects?"). An onboarding step adds a dismiss-step before
the user sees any value, and most users hit Continue without
understanding the choice. Inline-in-clone surfaces the same
information at the moment it matters and lets the default carry the
80% case in one click.

**Why over a settings-only / no-inline approach.** Users who run out
of disk on `C:\` (common on Windows) need to find a buried setting
to recover. Inline visibility prevents the "where did my files go?"
class of issue.

**Why over per-clone-always** (Cursor-style "Open folder"). Friction
scales with usage. Power users who want to redirect every clone get
the `[Change…]` button regardless; casuals who don't care never have
to click it.

### Stickiness + per-clone tracking

- The first time the user picks a custom location, it persists to
  `prefs.repos_base_dir`. Subsequent clones use it as the default —
  no re-prompting.
- Each clone's actual filesystem path is recorded in `repos.fs_path`
  at clone time. **Changing the default later does not move existing
  clones.** They keep loading from `fs_path`; only new clones use
  the new base.

### Settings panel (later changes)

Available from a gear icon, surfaces:

- The current default (`prefs.repos_base_dir`) with a folder picker.
- The list of cached repos with their actual `fs_path` and a
  per-repo **Move clone…** action that:
  1. Confirms the destination,
  2. Closes the active dev server if the repo is currently open,
  3. `fs.rename` (or copy + delete on cross-volume),
  4. Updates `repos.fs_path`, reopens the project at the new path.

Move is a one-shot user action, not part of any automated migration.
Users on the old default never need to do it.

### Implementation touchpoints (already encoded)

- `phase-1-plan.md` step 6 — `RepoCache.resolveBaseDir()` precedence.
- `phase-1-plan.md` step 7 — `repos.fs_path` column,
  `prefs.repos_base_dir` known key.
- `migration-plan.md` Phase 2 step 12 — clone API accepts `destBase`
  override, dialog renders the inline picker.

### Edge cases worth deciding now (not later)

- **Path with spaces / non-ASCII.** Allowed. Rejected only if
  `path.resolve` produces something outside the user's home tree
  AND the path doesn't already exist (defense against user
  confusion, not malice — the user picked it).
- **Network drives / external volumes.** Allowed. The user knows
  the disk may disappear; we handle the resulting "directory not
  found" error like we handle a manually-deleted clone — surface a
  clear message in the project switcher, do not crash.
- **Same `{owner}/{repo}` cloned to two different bases.** Refused.
  `repos.fs_path` is keyed off `(owner, name)` — one canonical
  location per repo. If the user wants two checkouts they should
  fork the repo on GitHub.

## Out of scope for Phase 0

- Code signing certificate ownership (Phase 5 blocker, not Phase 1+).
- Auto-update channel layout — addressed in Phase 5.
