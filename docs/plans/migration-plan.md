# TVE → Electron Migration Plan

Status: draft for review — do not implement.

Companion to `local-saas-migration.md`. That doc decides *what* to build;
this doc sequences *how* to build it without breaking the current CLI
workflow on `main`.

## Guiding principles

- **`main` stays shippable as the CLI tool throughout.** No phase
  requires breaking the existing `tve <path>` flow.
- **Additive over rewrite.** New `packages/desktop/`, new server routes,
  new editor screens — gated behind a `TVE_MODE` flag. Existing code in
  `services/git.ts`, `file-writer.ts`, `astro-parser.ts`, the proxy, and
  the file watcher carries over unchanged.
- **Risk lands late.** Server-side additions (auth, repo cache, token
  transport) are testable in the existing browser dev workflow. Electron
  shell, code signing, and auto-update are last.
- **Land early phases back to `main` behind the flag.** Don't let the
  feature branch drift for months.

## Phase 0 — Prep (no runtime changes)

1. **Branch.** `git checkout -b feat/local-saas` off `main`. All work
   lands here.
2. **Resolve plan blockers** (P1 findings in `local-saas-migration.md`):
   - GitHub App secret strategy → pick Option C (hosted token broker) or
     device flow.
   - Preview iframe sandbox/origin model → decide whether preview gets a
     separate localhost origin and what CSP applies.
   - Packaging model → server-serves-built-editor (recommended), so
     `/api`, `/preview`, `/ws` stay same-origin.
3. **Add a mode flag.** `TVE_MODE=cli|desktop` env var, default `cli`.
   Read once at server boot. New routes/screens are no-ops in `cli` mode
   until cutover.
4. **CI guardrail.** Add a job that boots the server in `cli` mode
   against `test-project/` and parses one page. This stays green for the
   entire branch lifetime.

## Phase 1 — Server foundations (browser dev workflow)

All testable via existing `pnpm dev`. No packaging, no shell.

5. **Centralize git transport** (P2 finding). New
   `packages/server/src/services/git-transport.ts`. Every network git op
   (`push`, `pull`, `fetch`, `clone`, staging provisioning, promotion
   merges, PR branch updates) goes through it. Initially a thin
   pass-through to `simple-git` with ambient auth; later injects tokens.
   No behavior change in `cli` mode.
6. **Repo cache layout.** `packages/server/src/services/repo-cache.ts` —
   resolves `~/.tve/repos/{owner}/{name}/`, handles clone/reuse/lockfile
   hash check. Exposed as an internal service, not used yet.
7. **Persistence layer.** `packages/server/src/services/state-store.ts`
   over SQLite (`better-sqlite3`) at `~/.tve/state.db`. Tables:
   `github_account`, `installations`, `repos`, `prefs`. In `cli` mode
   only `prefs` is read; `recent-projects.json` keeps working.
8. **Project switching extension.** Existing project switch route
   already exists (per P3 finding) — extend it to accept
   `{kind: "local"|"github", ...}` payloads. `local` keeps current
   behavior; `github` is wired in Phase 2.
9. **Project validator service.** New
   `packages/server/src/services/project-validator.ts` — single source
   of truth for "is this an Astro + Tailwind project?" Consolidates the
   existing inline `hasAstroConfig()` check from `routes/project.ts:67`
   and adds `hasTailwind()` (v3 + v4 detection, reusing the version
   probe logic in `services/tailwind-config.ts`). Exposes:

   ```ts
   type ValidationResult =
     | { ok: true; tailwindVersion: 3 | 4 }
     | { ok: false;
         reason: "no-astro-config" | "no-tailwind" | "unsupported-tailwind"
               | "too-large" | "symlink-escape";
         detail: string };

   validateLocalProject(dir: string): Promise<ValidationResult>;
   validateRemoteRepo(owner, repo, ref, token): Promise<ValidationResult>;
   ```

   `POST /api/project/switch` swaps its inline check for
   `validateLocalProject()`. Both local-folder and (Phase 2) GitHub
   code paths funnel through the same validator so rules stay
   identical.

**Exit criteria:** all CLI flows work unchanged. New services have unit
tests, including validator coverage for: missing `astro.config`, v3
config present, v4 `@theme` CSS present, neither present, symlink
escape attempt. SQLite store opens cleanly on Win/macOS/Linux.

## Phase 2 — Auth + repo provisioning (still browser dev)

9. **GitHub App.** Register the app, decide secret strategy. Build the
   hosted token-mint endpoint if going Option C. Document App ID +
   permissions in the repo.
10. **Auth routes.** `POST /api/auth/github/start`,
    `POST /api/auth/github/callback`, `POST /api/auth/github/device`.
    In `cli` mode these refuse with 404. In `desktop` mode they exchange
    codes via the broker and write the user token to a pluggable
    `TokenStore` interface.
11. **TokenStore: dev backend.** `FileTokenStore` (encrypted file under
    `~/.tve/`) for the browser dev workflow. **Not for production.**
    Behind `TVE_TOKEN_STORE=file|keychain` flag. Lets you exercise the
    auth flow without Electron.
12. **Repo picker API.** `GET /api/github/installations`,
    `GET /api/github/repos`, `POST /api/github/clone`. Streams
    `clone → install → ready` via WS.

    **Configurable cache directory.** Implements the locked decision
    in `phase-0-decisions.md` §4. `POST /api/github/clone` accepts
    an optional `destBase` override; otherwise it uses the active
    `repos_base_dir` pref (defaults to `~/.tve/repos/`). The clone
    dialog shows the resolved path inline with a `[Change…]` button.
    First-time override sticks via `prefs.repos_base_dir`; per-clone
    location tracked in `repos.fs_path`. Settings panel surfaces both
    the default pref and per-repo **Move clone…** actions for later
    relocations. See §4 for the full UX spec, edge cases, and
    rationale against onboarding-screen and per-clone-always
    alternatives.

    **Three-layer validation pipeline.** A non-Astro-Tailwind repo must
    not be cloneable, installable, or runnable. Fail fast at every
    layer:

    - **Layer 1 — pre-clone API probe.** Before "Clone & open" is
      enabled, the picker calls a new `GET /api/github/repos/validate`
      route that runs `validateRemoteRepo()`. That helper hits the
      GitHub Contents API (`GET /repos/{owner}/{repo}/contents/?ref=
      {branch}`) and rejects unless the repo has both an
      `astro.config.{mjs,ts,js,mts,cjs}` at root **and** either
      `tailwind.config.{mjs,ts,js,cjs}` (v3) or a CSS file containing
      `@import "tailwindcss"` / `@theme` (v4 — capped recursive search,
      ≤3 directory levels). Picker UI greys out incompatible repos with
      a tooltip explaining why. Same probe runs on branch switches in
      the picker. Cheap: one to a few API calls, no clone, no disk.

      ```
      [ ✓ ] acme/marketing-site       Astro + Tailwind v3
      [ ✓ ] acme/blog                 Astro + Tailwind v4
      [ ✗ ] acme/api-server           No astro.config found
      [ ✗ ] acme/old-jekyll-site      No astro.config found
      ```

    - **Layer 2 — post-clone, pre-install.** After clone but *before*
      `pnpm install`, re-run `validateLocalProject()` against the
      actual filesystem (Contents API can lag commits, and the
      filesystem is the one source of truth). On failure: skip install,
      stream `{ kind: "incompatible-project", reason, detail }` to the
      renderer, leave the cache dir intact so the user can inspect or
      hit "Remove from list."

    - **Layer 3 — `astro sync` preflight.** Already exists in
      `services/dev-server-preflight.ts`. Catches schema /
      `astro.config` errors before `astro dev` spawns. No change.

    **Additional safeguards** (all enforced in the clone path):

    - **Cap clone size.** Reject repos over a configurable limit
      (default 500 MB) before clone using the GitHub API's `size`
      field on `GET /repos/{owner}/{repo}` (KB). Surface as
      `reason: "too-large"`.
    - **Cap clone depth.** `git clone --depth 50` for the initial
      clone — full history isn't needed for visual editing. User can
      `git fetch --unshallow` later via the git panel if needed.
    - **Refuse symlink escapes.** After clone, walk the tree; if any
      symlink resolves outside the repo root, refuse and tear down the
      cache dir. Defense in depth on top of `lib/path-guard.ts`.
    - **Branch-switch revalidation.** A branch may delete
      `astro.config` mid-history. Run `validateLocalProject()` on
      every branch switch; block with a clear message instead of
      silently breaking the editor.
    - **Same validator for "Open local folder."** The CLI / local
      fallback path also runs through `validateLocalProject()` so the
      rule is identical regardless of how the project arrives.
13. **Token-backed git in transport layer.** `git-transport.ts` learns
    to mint a fresh installation token per call and inject it via
    `http.extraheader`. Never written to `.git/config`, scrubbed from
    remote URL post-clone.
14. **Editor screens (gated).** New `<SignInScreen>`, `<RepoPicker>`,
    `<CloneProgress>`. Mounted only when `mode === "desktop"` is
    reported by `/api/project/info`. In CLI mode the existing local-path
    picker stays.

**Exit criteria:** in a browser pointed at `localhost:3005` with
`TVE_MODE=desktop`, you can sign in via GitHub, pick a repo, clone it,
edit visually, and push back. No Electron.

## Phase 3 — Server bundling

15. **`packages/server` → single binary.** Node SEA (Node 22+) build.
    Validates that `better-sqlite3`, `keytar` (built but unused yet),
    `@astrojs/compiler` WASM all bundle correctly per platform. Adds a
    `pnpm --filter @tve/server build:binary` task. Standalone
    `tve-server` CLI works as a side benefit.
16. **Editor production bundle served by the server.** `packages/server`
    static-serves `packages/editor/dist/` at `/`. Confirms the
    same-origin packaging model works end-to-end.

**Exit criteria:** the binary boots on Win/macOS/Linux without a system
Node, serves the built editor, and passes the Phase 2 E2E in a browser.

## Phase 4 — Electron shell

Now wrap the working system. New code, no rework of Phases 1–3.

17. **`packages/desktop/`.** Electron main + preload. Spawns the Phase 3
    server binary as a child on a free localhost port, waits for
    `/api/health`, opens `BrowserWindow` at `http://localhost:{port}/`.
18. **Deep-link handler.** Register `tve://` scheme. macOS: `open-url`.
    Windows/Linux: `second-instance` + `app.setAsDefaultProtocolClient`.
    Forwards `tve://auth/callback?code=...` to
    `POST /api/auth/github/callback`.
19. **OS keychain bridge.** `keytar` lives in main process only. IPC
    exposes `getToken/setToken/deleteToken` to the server child via a
    stdin/stdout JSON-RPC channel (server never touches keychain
    directly). `KeychainTokenStore` becomes the prod `TokenStore`.
20. **Lifecycle.** Single-instance lock. On quit: stop Astro dev → stop
    server child → close. On child crash: dialog with "Restart" and a
    log link.
21. **Menus + window state.** File → Open Repo, View → Toggle Preview,
    Help → Logs. Persist window bounds in `state.db`.

**Exit criteria:** unsigned local Electron build passes the full E2E
on all three OSes (install → login → clone → edit → push → switch repo
→ reopen).

## Phase 5 — Distribution

22. **Code signing.** Apple Developer ID + notarization on macOS,
    Windows EV cert (Authenticode). Decide ownership (personal vs
    entity) before first signed build.
23. **Builds.** `electron-builder` configs for `.exe` (NSIS + portable),
    `.dmg` (universal), `.AppImage` + `.deb`. Output to GitHub Releases
    on tag push.
24. **`electron-updater`.** Stable channel against GitHub Releases.
    Verify update signature on each platform.
25. **First public release = v0.x beta.** Internal users only until
    signed E2E passes on all three OSes.

## Phase 6 — Cutover + cleanup

26. **Flip default mode.** `TVE_MODE` defaults to `desktop` when invoked
    from the Electron shell, `cli` otherwise. Both code paths stay
    alive.
27. **Merge `feat/local-saas` → `main`.** Squash-or-merge depending on
    commit hygiene; CHANGELOG entry per Keep-a-Changelog.
28. **Drop `FileTokenStore`** (dev-only) once Electron is the only
    desktop entry point.
29. **Documentation.** README split: "Run as desktop app" (download
    link) and "Run from source" (existing CLI flow, kept for
    contributors).

## Branch hygiene during the migration

- Rebase `feat/local-saas` onto `main` weekly. Small, focused commits
  per phase milestone.
- Land Phase 1 + 2 work in **incremental PRs back to `main` behind the
  mode flag** — they're additive and low-risk. `main` benefits from the
  centralized git transport, SQLite store, and project-switch extension
  regardless of when Electron ships.
- Only Phase 3+ stays on the long-lived branch until ready.
- If desktop work stalls, `main` is a stronger CLI tool. That's the
  safety net.

## Risk-ordered checklist

| Phase | Risk | Reversible? | Ships to users? |
|---|---|---|---|
| 0–1 | Low | Yes | No (flag-gated) |
| 2 | Medium (GitHub App, token handling) | Yes | No |
| 3 | Medium (native deps bundling) | Yes | No |
| 4 | High (Electron lifecycle, deep links) | Yes | Internal beta |
| 5 | High (signing, auto-update) | Hard once published | Public beta |
| 6 | Low | Yes | Public stable |

## Estimated scope

| Phase | Estimate |
|---|---|
| 0 — Prep | 1–2 days |
| 1 — Server foundations | ~1 week |
| 2 — Auth + provisioning | ~1 week |
| 3 — Bundling | ~1 week |
| 4 — Electron shell | ~2–3 weeks |
| 5 — Distribution + signing | ~1 week + signing cert lead time |
| 6 — Cutover | 1–2 days |

Total: **~6–8 focused weeks**, with `main` remaining shippable
throughout.

## What does NOT change

These carry over from the current app to the Electron build with no
structural changes — only the entry point and the project-path source
differ:

- `services/file-writer.ts` (magic-string mutation engine)
- `services/astro-parser.ts` (AST parsing + nodeId assignment)
- `services/tailwind-config.ts` (v3 + v4 theme read/write)
- `routes/dev-server.ts` (proxy + `<base>` tag injection)
- `routes/components.ts` (component create/extract/preview)
- `lib/path-guard.ts` (path traversal security)
- `packages/injected/` (overlay script)
- `packages/editor/` visual editing UI (properties, tree, design system,
  preview, content editor)
- All Phase 1–5 features documented in `CLAUDE.md`

## Open questions to close before Phase 2

1. **GitHub App private key location** — Option A (ship with app) vs
   Option B (per-user App) vs Option C (hosted token mint).
   Recommendation: Option C.
2. **Preview iframe isolation** — `sandbox` attribute? Separate
   localhost origin for preview vs editor? CSP for the editor shell?
3. **Code signing certificate ownership** — personal vs company entity
   on Apple/Microsoft developer accounts.
4. **Cache directory location** — *Resolved.* See
   `phase-0-decisions.md` §4 for the locked spec (default
   `~/.tve/repos/`, inline `[Change…]` in clone dialog, sticky pref
   via `prefs.repos_base_dir`, per-clone tracking via
   `repos.fs_path`, settings panel for later moves). Implemented in
   Phase 1 step 6 (data model) + Phase 2 step 12 (UX).

## Test gates per phase

- **Phase 1:** unit tests for `git-transport`, `repo-cache`,
  `state-store`, `project-validator` (missing astro.config, v3 config,
  v4 `@theme` CSS, no Tailwind, symlink escape). CLI E2E unchanged.
- **Phase 2:** integration test for OAuth callback round-trip,
  clone-to-cache, token-backed push against a fixture repo. Validator
  fixtures exercising all three layers: pre-clone API probe rejects a
  non-Astro repo, post-clone filesystem check rejects when Contents
  API lagged, branch switch to a branch missing `astro.config` is
  blocked. Size-cap and symlink-escape rejection also covered.
- **Phase 3:** binary boots and serves built editor on all three OSes.
- **Phase 4:** Electron E2E (install → login → clone → edit → push →
  switch → reopen) on all three OSes, unsigned.
- **Phase 5:** signed installer passes notarization (macOS) and
  SmartScreen (Windows). Auto-update happy-path + rollback.
- **Phase 6:** CLI mode still passes its CI job after merge.
