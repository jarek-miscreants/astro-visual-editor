# TVE Local-SaaS Migration Plan

Status: draft for review — do not implement.

A counter-proposal to `hosted-saas-migration.md`: keep TVE running on the
user's machine as an **Electron desktop app**, but add GitHub App
authentication and repo sync so the user can pick any of their GitHub
repos instead of typing a local path.

## Why this exists

The hosted plan inherits four hard problems that don't exist locally:

1. **Untrusted code execution.** Cloning a stranger's repo means running
   their `pnpm install` and `astro dev`. Locally, the user is running their
   own repos on their own machine — same trust model as `git clone` + `pnpm
   install` in a terminal.
2. **Preview routing.** Hosted needs a public per-session origin with
   wildcard TLS so Vite/HMR works through a gateway. Local keeps
   `http://localhost:{astroPort}/` and the existing `<base>` tag injection
   unchanged.
3. **Container isolation, warm pools, cold-start UX.** None apply.
4. **Multi-tenancy.** Single user. No tenant boundaries to police.

What's left: **GitHub auth + repo provisioning + token-backed push +
desktop packaging.** That is a significantly smaller piece of work than
the hosted plan, and almost all of the existing TVE codebase carries over
unchanged.

## Review findings against current app state

Status: plan review notes, not implementation tasks yet.

### P1 - Electron renderer sandbox is not enough by itself

The plan correctly says the Electron renderer should not need Node
integration, but that does not fully sandbox the user's Astro project. The
current editor renders the preview iframe from `/preview/` without an iframe
`sandbox` policy, and the iframe runs repo-authored JavaScript inside the
Electron window. That code may be able to reach localhost APIs unless the app
intentionally separates origins and restricts what preview content can do.

Before implementation, the plan needs a concrete preview isolation decision:

- whether the preview iframe gets a `sandbox` attribute;
- whether preview and editor run on different localhost origins;
- which APIs the injected overlay may call;
- whether project JavaScript can reach TVE's backend routes;
- what CSP applies to the editor shell and the preview document.

This is much smaller than hosted untrusted-code isolation, but it is still a
real desktop security boundary.

### P1 - GitHub App OAuth needs a desktop-safe secret strategy

The primary `tve://` deep-link flow is directionally right, but the current
description skips an important GitHub App detail: exchanging an OAuth code for
a user access token requires the app's client secret. That secret should not be
shipped in the Electron app or the local TVE server.

The plan should pick one of these before implementation:

- make the hosted token broker handle both OAuth code exchange and
  installation-token minting;
- make device flow the primary desktop auth path if it avoids shipping
  sensitive app credentials;
- require a user-provided GitHub App, which is more secure but much worse UX.

If Option C remains the recommendation, it should be expanded from "mint
installation tokens" to "perform all GitHub App secret-backed exchanges."

### P2 - PR flow is new work, not unchanged current behavior

The plan says "Push/PR flow unchanged from the hosted plan," but the current
app does not yet have PR creation routes or PR UI. It has local git status,
branch switching, commit, push, pull, staging setup, and staging/production
promotion.

The plan should treat these as new scope:

- create/update PR via GitHub API;
- publish-mode selector for "open/update PR" vs "direct push";
- branch-protection-aware fallback from direct push to PR;
- UI for PR URL, PR state, and errors.

Direct push can build on the current git panel. PR default cannot be described
as carrying over unchanged.

### P2 - Token-backed git must cover promotion code paths

The plan says only `services/git.ts` `push()` and `pull()` need token
injection. Current git operations also push or pull inside higher-level
workflows, including staging setup and promotion. Those code paths currently
call git directly and would still rely on ambient OS git auth unless the token
strategy is centralized.

Before implementation, define a single token-aware git transport layer used by
all network operations:

- push;
- pull;
- fetch;
- clone;
- staging branch provisioning;
- promotion merges that push the target branch;
- PR branch updates.

### P2 - Built editor asset loading needs an explicit packaging decision

The current editor frontend assumes same-origin `/api` calls. In local dev,
Vite proxies `/api`, `/preview`, and `/ws` to the backend. In Electron
production, this only works if either:

- the TVE server serves the built editor assets and the `BrowserWindow` loads
  `http://localhost:{tvePort}/`; or
- the frontend receives a configurable API base URL when loaded from `file://`
  or a custom Electron protocol.

The plan currently says the window may point at the server or load built
assets, but those are not equivalent. Pick one packaging model before work
starts. Recommendation: have the server serve the built editor bundle in
desktop production so `/api`, `/preview`, and `/ws` remain same-origin.

### P3 - Runtime project switching already exists

The plan describes moving `app.locals.projectPath` from startup-only to
runtime-selected as "the big shift from today." That has already largely
happened: the server can start without an initial project path and exposes a
project switch route that stops the old Astro server, rebuilds the watcher,
and sets the new project path.

The remaining work is better described as extending the existing project
switching flow:

- add GitHub repo selection;
- clone or reuse the cached checkout;
- install dependencies when needed;
- switch the active project to the cached checkout;
- persist repo metadata in SQLite instead of the current recent-projects JSON
  file.

## Locked choices

- **Desktop shell:** Electron. VS Code / GitHub Desktop / Cursor model —
  not the Slack/Asana model. The backend lives on the user's machine, not
  on a server.
- **Auth:** GitHub App with browser-based OAuth using a `tve://` deep link
  for the callback. Device flow as a fallback. No separate OAuth App.
- **Token storage:** OS keychain (Windows Credential Manager / macOS
  Keychain / libsecret on Linux) via `keytar` or equivalent. Never on disk
  in plaintext.
- **Repo storage:** local cache dir at `~/.tve/repos/{owner}/{name}/`,
  user-overridable per clone. One clone per repo, reused across sessions.
- **Branch model:** user picks repo + branch. Editing happens on the
  checkout. Push/PR flow unchanged from the hosted plan (PR default,
  direct push opt-in).
- **Persistence:** SQLite at `~/.tve/state.db`. No Neon, no server-side
  database. Stores: known installations, cached repo paths, last-opened
  branch per repo, user prefs.
- **Distribution:** signed Electron installer (`.exe` / `.dmg` /
  `.AppImage`) with `electron-updater` for auto-update.

## Architecture

The shape is "VS Code, but for visual editing." Three processes inside
the desktop app, plus the user's Astro dev server as a child.

```
┌────────────────────────────────────────────────────────────┐
│  Electron app (TVE.exe / TVE.app)                          │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐  │
│  │  Main process       │    │  Renderer (BrowserWindow)│  │
│  │  ───────────────    │    │  ──────────────────────  │  │
│  │  • Window mgmt      │◄──►│  Editor frontend         │  │
│  │  • Menus/tray       │IPC │  (built React assets,    │  │
│  │  • Deep links       │    │   no Vite dev server in  │  │
│  │  • Auto-update      │    │   prod; calls localhost) │  │
│  │  • OS keychain      │    └──────────────────────────┘  │
│  │  • Spawns server ─┐ │                                   │
│  └─────────────────┬─┘ │                                   │
│                    ▼   │                                   │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  TVE server (child Node process)                     │ │
│  │  ────────────────────────────                        │ │
│  │  • Existing packages/server, listens on localhost    │ │
│  │  • File watcher, AST parser, mutation engine         │ │
│  │  • git via simple-git + minted installation tokens   │ │
│  │  • Spawns Astro dev server ─┐                        │ │
│  └─────────────────────────────┼────────────────────────┘ │
│                                ▼                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Astro dev server (child Node process)               │ │
│  │  Runs the user's project from the cache dir,         │ │
│  │  served at localhost:{auto-assigned port}.           │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
                       │
                       ▼ HTTPS to api.github.com (auth, push, pull)
                       ▼ HTTPS to npm registry (during pnpm install)
```

Key points:

- The renderer **does not** require Node integration; it talks to the
  TVE server over HTTP/WebSocket on `localhost`, exactly as the
  browser-based dev workflow does today. This keeps the renderer
  sandboxed and means the same frontend bundle can run in either context.
- The TVE server is **a separate child process**, not embedded in the
  Electron main process. This preserves the ability to run `packages/
  server` standalone (for the dev workflow, for CI, and for a future
  hosted variant where the same code runs as a worker).
- Everything that exists today — file watcher, AST parser, mutation
  engine, proxy, all of `services/git.ts` except `push`/`pull` — runs
  unchanged inside the spawned server.

The big shift from today: `app.locals.projectPath` is no longer set at
process start from a CLI argument — it's set by the user choosing a repo
in the UI, which triggers a clone (or reuse) into the cache dir.

## What changes

### 1. Electron shell

- New `packages/desktop/` (or `apps/desktop/`) with the Electron main
  process.
- Responsibilities:
  - Spawn `packages/server` as a child process, wait for the
    `localhost:{port}` listener to be ready, then create a
    `BrowserWindow` pointing at it (or loading the built editor and
    making API calls back to that port).
  - Register the `tve://` URL scheme with the OS so GitHub's OAuth
    callback can land in the app.
  - Bridge OS keychain access to the server via a small IPC handler —
    only the main process has direct keychain permission.
  - Single-instance lock: opening a second TVE process refocuses the
    existing window instead of starting a second backend.
  - Native menus (File → Open Repo, View → Toggle Preview, etc.) wired
    to the same actions the in-app UI exposes.
  - Lifecycle: on quit, terminate the Astro dev server first, then the
    TVE server, then close. On crash of either child, surface a dialog
    and offer a restart instead of hard-failing.
- `electron-updater` handles auto-update against signed releases hosted
  on GitHub Releases (or S3/R2). Staged rollouts supported out of the box.

### 2. GitHub App + auth flow

- Register a GitHub App with permissions `contents:write`,
  `pull_requests:write`, `metadata:read`.
- **Primary flow: browser callback via `tve://` deep link.**
  - User clicks "Sign in with GitHub" → main process calls
    `shell.openExternal('https://github.com/login/oauth/authorize?...&
    redirect_uri=tve://auth/callback')`.
  - GitHub authenticates the user and redirects to `tve://auth/
    callback?code=...`.
  - The OS hands the deep link back to the running Electron app, which
    catches it via the `open-url` (macOS) / `second-instance` (Windows /
    Linux) hooks and forwards the code to the TVE server.
  - Server exchanges the code for a user-to-server token and writes it
    to the OS keychain.
  - This avoids the localhost-callback dance hosted-style apps have to
    do, and works without opening a port specifically for auth.
- **Fallback: device flow.** User copies a code into github.com on
  whatever device they want. Useful when deep links are misconfigured or
  when running TVE in a remote/headless context.
- Installation tokens (~1h TTL) are minted on demand from the App's
  private key. **Open question: where does the App private key live?**
  - Option A: shipped with TVE (every install shares one App). Simplest;
    means anyone running TVE can talk to your App.
  - Option B: each user creates their own GitHub App. Most secure; bad UX.
  - Option C: TVE runs a tiny hosted endpoint that mints installation
    tokens on behalf of authenticated users. Requires a single
    Workers/Lambda endpoint — no workspace runtime, no database.
  - **Recommendation:** Option C. Keeps the App private key off user
    machines; the rest of the system stays local.

### 3. Repo picker UI

- New screen at first launch (and accessible from the project switcher):
  - "Sign in with GitHub" if no token yet.
  - List of installations → list of repos within each → branch dropdown.
  - "Clone & open" button.
  - "Install on more repos" link → opens `https://github.com/apps/tve/
    installations/new` in the user's browser; the app's webhook /
    next-launch refresh picks up the newly granted repos.
- Replace the existing local-path picker with this. Keep "Open local
  folder" as a secondary option for users editing pre-cloned repos
  outside the cache dir (or repos hosted somewhere other than GitHub).

### 4. Repo provisioning

- On "Clone & open":
  - Resolve cache path: `~/.tve/repos/{owner}/{name}/`.
  - If absent: clone using `https://x-access-token:${TOKEN}@github.com/
    ...`, then immediately rewrite the remote URL to plain
    `https://github.com/{owner}/{name}.git` so the token isn't persisted
    in `.git/config`.
  - If present: `git fetch`; offer to switch branch / rebase / discard
    based on local state.
- Set `app.locals.projectPath` to the cache path. The existing file
  watcher, AST parser, dev-server starter, and proxy all work unchanged
  against the new path.
- Run `pnpm install` (or detected package manager) once on first clone;
  cache the lockfile hash so we skip it on reopen unless the lockfile
  changed.
- Stream `clone → install → preflight → starting → ready` progress to
  the renderer so the first-run wait isn't a blank spinner.

### 5. Git push/pull with token

- `services/git.ts` `push()` and `pull()` change from "rely on ambient
  OS git auth" to "inject a fresh installation token into the URL for the
  duration of the call".
- Concretely: `git -c http.extraheader="Authorization: Basic ${b64}" push
  origin <branch>`, with the token regenerated per call. No token ever
  written to `.git/config` or env files.
- All other git operations (`status`, `diff`, `commit`, `branch`,
  `checkoutBranch`, `promote`) carry over unchanged.

### 6. Multi-repo session management

- Today there's one `projectPath` per process. Add the ability to switch
  between cached repos without restarting the backend:
  - Stop the running Astro dev server.
  - Tear down the file watcher.
  - Set the new `projectPath`.
  - Start a fresh Astro dev server against the new path.
- Surfaces as a project switcher in the Toolbar (`projectName` button is
  already there — wire it to the repo picker).

### 7. Persistence (SQLite)

Tables (or JSON file if you'd rather skip a dep):

- `github_account` — single row: login, avatar, user-token reference key
  in the keychain.
- `installations` — installation_id, account_login, granted at.
- `repos` — owner, name, cache_path, last_opened_at, last_branch,
  install_lockfile_hash.
- `prefs` — last_active_repo, ui prefs.

No `workspace_sessions`, no `workspace_events` — single-user, single
session.

### 8. Editor UI changes

- New: GitHub login screen, repo picker, branch picker, first-run
  progress (clone/install/start states).
- Modified: project switcher button → opens repo picker.
- Modified: Git panel → publish-mode selector (PR vs direct push); push
  uses installation token instead of OS git.
- Unchanged: visual editor, properties panel, design system, content
  editor, tree, preview, all of `services/git.ts` except `push`/`pull`.

## End-to-end workflow

### First-time launch

1. **Install.** User downloads `TVE.exe` / `TVE.dmg` / `TVE.AppImage`.
   Standard installer flow. App icon appears in their OS launcher.
2. **First open.** Welcome screen: "Sign in with GitHub." Electron main
   process spawns the bundled TVE server on a free localhost port; the
   `BrowserWindow` loads the editor frontend served by it.
3. **Auth.** Click sign-in → default browser opens to GitHub. User
   approves. GitHub redirects to `tve://auth/callback?code=...`. The OS
   hands the deep link back to the Electron app, which exchanges the
   code, stores the resulting user token in the OS keychain.
4. **Repo picker.** App calls GitHub API with the user token, lists
   installations and repos. User picks one. (If no installations exist,
   user is sent to `https://github.com/apps/tve/installations/new` to
   grant repo access; on return, the app refreshes the list.)
5. **Clone.** App mints a fresh installation token, clones into
   `~/.tve/repos/{owner}/{name}/`, rewrites the remote URL to scrub the
   token from `.git/config`. Progress streams to the UI.
6. **Install deps.** `pnpm install` runs once. Lockfile hash cached so
   we skip it on future opens of the same repo.
7. **Start preview.** Spawn `astro dev` on an auto-assigned port. The
   existing proxy at `localhost:{tve-port}/preview/` injects the `<base>`
   tag and routes to it.
8. **Editor opens.** User sees the page tree, picks a page, edits
   visually. Edits write to `~/.tve/repos/{owner}/{name}/src/...` on
   their disk. Astro HMR refreshes the iframe instantly.

### Subsequent launches

1. App opens. Window appears immediately. Last-opened repo is shown in
   the project switcher.
2. Click it → `git fetch` for upstream, `astro dev` against the cached
   repo. ~3 seconds because clone + install are already done. If the
   lockfile changed since last run, install re-runs; otherwise skipped.
3. Edit, commit, push as usual.

Switching repos: same flow, no new install needed once cached.

### Where data lives

| Thing | Location |
|---|---|
| TVE app itself | `C:\Program Files\TVE\` or `/Applications/TVE.app` |
| User's repo clones | `~/.tve/repos/{owner}/{name}/` (one per repo) |
| GitHub user token | OS keychain (encrypted by the OS) |
| TVE state (last-opened repo, prefs, install lockfile hashes) | `~/.tve/state.db` |
| Shared `pnpm` content store | `~/.tve/pnpm-store/` |
| Logs | `~/.tve/logs/` (rotated) |

**Nothing is sent anywhere except GitHub** (and npm during install, and
whatever the user's Astro project itself fetches). No telemetry server,
no central database, no cloud sync. The user is in charge of when their
work goes to GitHub via the git panel.

## Coexistence with other tools (LLMs, IDEs, CLIs)

Because the repo at `~/.tve/repos/{owner}/{name}/` is a normal git
checkout on the user's filesystem, **every other tool the user has
already works against it.** This is a real differentiator versus the
hosted SaaS plan, where the repo is trapped inside an ephemeral
container.

What works automatically:

- User can open the same directory in VS Code / Cursor / Zed and have
  Claude / Copilot / Cursor agents edit files. TVE's existing `chokidar`
  watcher detects the changes, re-parses the AST, and the tree/property
  panel reflect the new state. Astro HMR refreshes the iframe.
- User can run CLI agents (`claude`, `aider`, `gh copilot`) in the same
  directory. Same outcome.
- User can hand-edit files in any editor, run `pnpm` commands, run
  `astro build`, run their own scripts.
- All of those edits can be committed and pushed from any tool. TVE's
  git panel sees them as dirty files like any other.

Edges to be aware of (worth surfacing in the UI, not blocking work):

- **Concurrent writes to the same file.** TVE's `validateElementRange()`
  already guards against catastrophic offset corruption; an additional
  "checksum the file before applying mutation, abort if changed" guard
  is a cheap follow-up if races become real.
- **Dependency changes.** If an external tool runs `pnpm add`, the
  running Astro dev server doesn't auto-restart. A "deps changed,
  restart preview?" banner makes this self-service.
- **Pushes from two tools.** Standard `non-fast-forward` rejection.
  Surface as "remote moved — pull first" instead of an opaque error.

Future follow-ups (not v1, but enabled by the local model):

- **`tve://open?repo=...&file=...` deep links** so any tool can hand the
  user a link straight to a specific element in TVE.
- **"Open in Cursor" context menu** on tree nodes — spawns the user's
  configured editor at the right line.
- **JSON-RPC mutation interface** on `localhost` so agents can perform
  AST-correct structural edits via TVE's mutation engine instead of
  writing source text directly.

## What you give up vs hosted SaaS

- **No "open editor from anywhere".** User must be on a machine with TVE
  installed.
- **No real-time multi-user co-editing.** Each user runs TVE locally
  against their own clone; collaboration happens via PRs.
- **Distribution overhead.** Must ship signed installers per platform,
  handle code signing renewals (~$200/year for Windows EV cert), Apple
  notarization, auto-update infrastructure.
- **No central observability.** Crash logs land on user machines; you
  see nothing unless the user opts into telemetry you haven't built yet.

## What you keep that hosted gives up

- **Trust model = git CLI.** No untrusted code problem.
- **Native filesystem.** No cache eviction, no idle teardown, no
  dirty-state recovery problems.
- **No infra.** No containers, no gateway, no Neon, no warm pools, no
  per-active-hour cost. Single tiny token-mint endpoint (Option C)
  optional.
- **All existing code carries over.** `services/git.ts`,
  `services/file-writer.ts`, `services/astro-parser.ts`, the proxy, the
  file watcher, the editor frontend — none of it needs structural
  change. Only auth, repo provisioning, and the Electron shell are new.
- **No preview routing problem.** Localhost + base tag still works.
- **Same-filesystem coexistence with every other dev tool.** See above.

## Comparison at a glance

| Concern | Hosted SaaS | Local-SaaS (Electron) |
|---|---|---|
| Untrusted code execution | Big problem; needs gVisor/Firecracker + egress allowlist | Not applicable |
| Preview routing | Subdomain-per-session OR path-prefix proxy + WS rewriting | Localhost, unchanged |
| Cold start | Container boot + clone + install + dev server (30–120s) | Clone + install once per repo, then warm |
| Multi-tenancy | Required across the whole stack | None |
| Database | Neon Postgres, pooled | SQLite at `~/.tve/state.db` |
| Token storage | Mint per-request, never store | OS keychain |
| Concurrent same-branch sessions | Conflict-on-push UX needed | One user, one machine |
| Warm pools | Required to hide cold start | Not applicable |
| Egress filtering | Required (supply-chain) | Not applicable |
| Distribution | Web app — open the URL | Signed installer + auto-update |
| Team collaboration | Possible (multi-tenant by definition) | Via PRs only in v1 |
| Coexistence with other dev tools | Impossible (repo is in a container) | Built-in (it's just a folder) |
| Cost per active hour | Real money | Effectively zero |

## Migration path

This isn't either/or. Local-SaaS is a **stepping stone** toward hosted:

1. Build local-SaaS (Electron) first. Ship it. Real users on real repos
   with real GitHub auth — proves the auth + provisioning + token-push
   code paths.
2. The control-plane / worker split, container isolation, gateway,
   preview routing, and Neon are the *additional* work to go from
   local-SaaS to hosted-SaaS. None of it invalidates the local-SaaS
   work; it's purely additive.
3. Could even ship both — local for power users / privacy / free, hosted
   for "I just want to click a link" users.

## Open decisions

1. **GitHub App private key location** — ship-with-app vs hosted token
   mint vs per-user App. Recommendation: hosted token mint (Option C).
2. **Cache directory location** — `~/.tve/repos/` vs user-chosen at
   first run vs per-repo destination. Recommendation: default to
   `~/.tve/repos/`, allow override per-clone.
3. **Auto-update channel strategy** — single stable channel, or
   stable + beta? Recommendation: single stable for v1; add beta when
   user count justifies it.
4. **Code signing certificate ownership** — personal vs company entity
   on Apple/Microsoft developer accounts. Affects who can release.
   Decide before first release, not first build.

## Test Plan

- **Unit:** GitHub App auth helpers, keychain read/write wrapper, token
  mint, repo cache path resolution, deep-link URL parsing.
- **Integration:** OAuth callback handling, clone-to-cache, branch
  switch, fetch + status, commit, push with injected token, PR creation.
- **Security:** token never written to disk in plaintext, never persisted
  to `.git/config`, removed from process env after git invocation, OS
  keychain integration on each platform (Windows / macOS / Linux),
  renderer sandboxed (no Node integration).
- **Electron-specific:** single-instance lock prevents two backends,
  child-process cleanup on quit (no orphan Node / Astro processes),
  deep-link callback delivery on cold start vs running app, auto-update
  rollback on bad release, code signing valid on each platform.
- **E2E:** install fresh app → first-run login → install GitHub App →
  pick repo → clone → start preview → edit → commit → push direct →
  open PR → switch to a different repo → reopen the first repo and
  confirm state restored.

## Recommendation

If "anyone can edit my Astro site from a browser tab" isn't a hard
product requirement, **start here**, not with the hosted plan. You get
80% of the user benefit (GitHub-backed editing, no manual `git clone`,
no `tve <path>` CLI dance) for ~10% of the engineering cost, the
"works with every other dev tool" advantage of a real filesystem repo,
and everything you build is reusable when/if you add the hosted variant
later.

## Appendix — Distribution roadmap

The Electron desktop app is the v1 distribution target, but it's worth
building toward incrementally rather than going from "pnpm dev" to
"signed Electron installer with auto-update" in one step.

### Phase 1 — Bootstrap script (parallel to development)

A one-liner (`npx create-tve@latest` or `curl … | sh`) that clones the
repo, runs `pnpm install`, and drops a `tve` command on PATH. Useful
for early testers and contributors regardless of where the desktop
distribution lands. Cost: an afternoon.

### Phase 2 — Server bundle as a single binary

Package `packages/server` (and its native deps) into a single Node
binary via `Node SEA` (stable in Node 22+) or `esbuild` + a Node
runtime. Validates the bundling story — `better-sqlite3`, `keytar`,
`@astrojs/compiler` WASM all need correct per-platform handling — without
the additional Electron complexity. Useful as a standalone CLI tool too.
Cost: ~1 week.

### Phase 3 — Electron shell (the v1 ship target)

Wrap the Phase 2 server binary as the spawned child of an Electron main
process. Add window, menus, deep-link handler, OS keychain bridge,
auto-update via `electron-updater`, code signing (Apple notarization +
Windows Authenticode), single-instance lock.

- Three platform builds: Windows (`.exe` installer + portable),
  macOS (`.dmg`, universal binary covering Intel + Apple Silicon),
  Linux (`.AppImage` + `.deb`).
- ~150 MB per platform after Chromium.
- Auto-update against signed releases on GitHub Releases.

Cost: ~2–3 weeks on top of Phase 2. The Phase 2 binary is reused as the
Electron sidecar, so no rework.

### Phase 4 (deferred) — Project dependency caching

Pre-populate `~/.tve/pnpm-store/` with common Astro/Tailwind deps to
make first-clone install drop from 60s to ~5s. Optional toolchain
manager (`mise` / `volta`) so the user doesn't need a system Node for
their Astro project either. Only worth doing if first-clone time becomes
a real user complaint. Not v1.

### Why Electron, not Tauri

- The entire backend is Node. With Electron, it's a process the main
  process spawns directly. With Tauri, it's a sidecar process the Rust
  core supervises — same idea but more boilerplate, more debugging
  across a language boundary, and you lose Tauri's main "small binary"
  advantage once you bundle a Node sidecar anyway.
- Visual editor depends on consistent CSS rendering across user
  machines. Chromium-everywhere (Electron) is more reliable than
  OS-webview-everywhere (Tauri), where macOS WebKit and especially
  Linux WebKitGTK can differ in subtle ways.
- `electron-updater` is more battle-tested than Tauri's updater for
  staged rollouts — relevant once real users are on the app.
- Faster dev loop. No Rust recompiles, no two-language debugging.
- Boring and works. VS Code, Cursor, Linear, Slack, GitHub Desktop,
  1Password, Postman, Notion, Discord — all Electron. Long list, well-
  understood failure modes.

Tauri remains a defensible choice; Electron is the boring correct one
for TVE's specific shape (Node-heavy backend, design-tool UI).
