# Phase 1 — Server Foundations: Implementation Plan

Status: draft for review — do not implement until approved.

Companion to `migration-plan.md` Phase 1 (steps 5–9). Phase 0 is in
place (`feat/local-saas` branch, `TVE_MODE` flag wired through
`app.locals.mode`, plan blockers locked in `phase-0-decisions.md`).

This doc spells out the concrete file layout, API contracts, test
plan, and exit criteria for Phase 1. Everything below is additive and
guarded by `TVE_MODE`. The CLI flow on `feat/local-saas` (and
ultimately `main`) must keep passing `pnpm dev` against `test-project/`
through every step.

## Phase 1 scope (one-line summary per step)

| # | Step | New file | Touched files |
|---|------|----------|----------------|
| 5 | Centralize git transport | `services/git-transport.ts` | `services/git.ts`, `routes/git.ts` |
| 6 | Repo cache layout | `services/repo-cache.ts` | — (not consumed yet) |
| 7 | Persistence layer | `services/state-store.ts`, `services/state-store-migrations.ts` | `services/recent-projects.ts` (read-through) |
| 8 | Project switch extension | — | `routes/project.ts`, `packages/shared/src/types.ts` |
| 9 | Project validator | `services/project-validator.ts` | `routes/project.ts` (swap inline check) |

## Guiding constraints

- **CLI mode = identical behavior.** Every new service is either inert
  in `cli` mode or invoked behind a check that no-ops there.
- **No editor work in Phase 1.** All changes ship in `packages/server`
  + `packages/shared`. The repo picker / sign-in screens are Phase 2.
- **Native deps land here, not later.** `better-sqlite3` is the only
  new native dep in Phase 1. Adding it now lets Phase 3 (binary
  bundling) hit the bundling problem early instead of at the end.
- **No new HTTP endpoints exposed in `cli` mode.** Routes that only
  make sense in desktop mode (e.g. token introspection) will return
  404 when `app.locals.mode === "cli"`.

---

## Step 5 — Centralize git transport

**Files**

- New: `packages/server/src/services/git-transport.ts`
- Edited: `packages/server/src/services/git.ts` — every network call
  routes through the transport.
- Edited (no logic change): any other call site that runs `git push`,
  `pull`, `fetch`, or `clone` directly. Audit list below.

**Contract**

```ts
// services/git-transport.ts
import type { SimpleGit } from "simple-git";

export interface GitTransport {
  /** Wraps push/pull/fetch/clone. Implementations may inject auth. */
  push(repoPath: string, args?: string[]): Promise<void>;
  pull(repoPath: string, args?: string[]): Promise<void>;
  fetch(repoPath: string, args?: string[]): Promise<void>;
  clone(url: string, dest: string, args?: string[]): Promise<void>;
}

/** Phase 1: thin pass-through to simple-git. No token injection. */
export function createAmbientGitTransport(): GitTransport;

/** Phase 2: wraps `createAmbientGitTransport` and injects an
 *  installation token via `http.extraheader`. Defined here so the
 *  signature is owned by Phase 1; not implemented yet. */
// export function createTokenGitTransport(tokenStore: TokenStore): GitTransport;
```

The transport is constructed once at server boot and stored on
`app.locals.gitTransport`. Phase 2 swaps the implementation when
`mode === "desktop"`; Phase 1 always uses the ambient pass-through.

**Audit — every git network call to migrate**

From `packages/server/src/services/git.ts`:

- `push()` (line ~243)
- `pull()` (line ~256)
- staging branch provisioning — `git.pull(["--ff-only", ...])` (~391)
  and `git.push(["--set-upstream", ...])` (~405)
- any other `git.push` / `git.pull` / `git.fetch` / `git.clone` —
  grep before merging.

Local-only ops (`status`, `log`, `diff`, `add`, `commit`, branch
create/checkout, stash) **stay on `simpleGit` directly**. They don't
touch the network and don't need transport indirection.

**Tests**

`packages/server/src/services/git-transport.test.ts`:

- Ambient transport invokes `simpleGit().push/pull/fetch/clone` with
  the expected args (mock simple-git).
- Errors from simple-git surface through the transport unchanged.
- `git.ts` push/pull regression test: confirms `push()` /
  `pull()` produce identical commands before and after the refactor
  (use a sandbox repo + spy).

**Risk**

Low. Behavior is unchanged in CLI mode; the wrapper is a function
call indirection only. The audit step is the part that catches bugs
— missing a call site is silent until Phase 2 token injection breaks.

---

## Step 6 — Repo cache layout

**Files**

- New: `packages/server/src/services/repo-cache.ts`
- Not wired into any route in Phase 1 — exposed and unit-tested only.

**Layout**

```
~/.tve/                      # state dir, created lazily
  state.db                   # step 7

{repos_base_dir}/            # default ~/.tve/repos, user-overridable
  {owner}/{repo}/
    .tve-meta.json           # { lockHash, installedAt, lastUsedAt }
    <full repo checkout>
```

**State directory** (`~/.tve/`) holds `state.db` and is fixed —
resolves via `os.homedir()`, overridable via `TVE_HOME` env var for
tests and dev. On Windows this is `%USERPROFILE%\.tve\` (e.g.
`C:\Users\jarss\.tve\`).

**Repos base directory** is decoupled from the state directory and
user-configurable. Resolution order at clone time:

1. Explicit `destBase` argument passed to the clone API (Phase 2,
   step 12).
2. `prefs.repos_base_dir` from `state.db` (set by the user once).
3. Default `path.join(tveHome(), "repos")` (i.e. `~/.tve/repos/`).

The actual destination of each clone is `{base}/{owner}/{repo}/` and
is **persisted in `repos.fs_path`** at clone time (see step 7).
Changing the default later does not move existing clones — they keep
loading from `fs_path` until the user explicitly relocates them via
the settings panel. New clones go to the new base.

**Contract**

```ts
export interface RepoCacheEntry {
  owner: string;
  repo: string;
  path: string;            // absolute filesystem path
  lockHash: string | null; // sha256 of pnpm-lock.yaml | package-lock.json | yarn.lock
  installedAt: number | null;
  lastUsedAt: number;
}

export interface RepoCache {
  /** Resolves the active base directory at call time: explicit override
   *  > prefs.repos_base_dir > default `~/.tve/repos/`. */
  resolveBaseDir(override?: string): Promise<string>;
  /** Compute `{base}/{owner}/{repo}/` against a given base. The caller
   *  passes the resolved base from `resolveBaseDir()` so the choice is
   *  visible in the UI before any disk activity. */
  resolvePath(base: string, owner: string, repo: string): string;
  exists(absPath: string): Promise<boolean>;
  read(absPath: string): Promise<RepoCacheEntry | null>;
  /** Ensures the cache dir exists at the given absolute path. Does
   *  NOT clone — clone is the caller's job. */
  ensureDir(absPath: string): Promise<void>;
  /** Recompute and persist `lockHash` after a clone or `git pull`. */
  recordLockHash(absPath: string): Promise<string | null>;
  /** Decide whether to re-run `pnpm install` (lockHash differs). */
  needsInstall(absPath: string): Promise<boolean>;
  remove(absPath: string): Promise<void>;
}

export function createRepoCache(stateStore: StateStore): RepoCache;
```

**Lockfile hash computation**

Reads the first matching file in priority order: `pnpm-lock.yaml`,
`package-lock.json`, `yarn.lock`. SHA-256 of the file bytes. If none
exist, returns `null` and `needsInstall()` returns `true` (caller
must always run install).

**Tests**

`packages/server/src/services/repo-cache.test.ts` (uses a `TVE_HOME`
override into a `tmp` dir):

- `resolveBaseDir` precedence: explicit override > prefs > default.
- `resolvePath` produces `{base}/{owner}/{repo}/` for any base.
- `ensureDir` creates the nested tree.
- `recordLockHash` then `needsInstall` returns `false` for the same
  lockfile, `true` after the lockfile changes.
- `remove` deletes the entry.
- Symlink handling: writing/reading entries inside a path that crosses
  a symlink is rejected (defense in depth — primary check is
  `lib/path-guard.ts` in Phase 2).

**Risk**

Low. No callers in Phase 1. The layout decision lands now so Phase 2
slots it in.

---

## Step 7 — Persistence layer (SQLite)

**Files**

- New: `packages/server/src/services/state-store.ts`
- New: `packages/server/src/services/state-store-migrations.ts`
- New dep: `better-sqlite3` (production), `@types/better-sqlite3` (dev).
- Edited: `packages/server/src/services/recent-projects.ts` — read
  from `recent_projects` view in `state.db` if available, else
  fall back to `recent-projects.json`. Writes still go to JSON in
  CLI mode for backwards compatibility (one-way migration only).

**Schema (v1)**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS github_account (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  github_id INTEGER NOT NULL UNIQUE,
  avatar_url TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS installations (
  id INTEGER PRIMARY KEY,        -- GitHub installation_id
  account_id INTEGER NOT NULL REFERENCES github_account(id) ON DELETE CASCADE,
  account_login TEXT NOT NULL,   -- denormalized for quick listing
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  -- Absolute filesystem path of this clone. Recorded at clone time so
  -- changing prefs.repos_base_dir later does not orphan existing
  -- clones; they continue to load from fs_path until the user moves
  -- them via the settings panel.
  fs_path TEXT NOT NULL,
  last_opened_at INTEGER,
  UNIQUE (owner, name)
);

CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL          -- JSON-encoded
);

CREATE TABLE IF NOT EXISTS recent_projects (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_opened_at INTEGER NOT NULL
);
```

**Contract**

```ts
export interface StateStore {
  /** Opens (or creates) ~/.tve/state.db, runs pending migrations. */
  open(): Promise<void>;
  close(): void;

  // GitHub account / installation / repos — Phase 2 consumers
  upsertAccount(input: { login: string; githubId: number; avatarUrl?: string }): GithubAccount;
  listInstallations(): Installation[];
  upsertInstallation(input: { id: number; accountLogin: string }): Installation;
  listRepos(installationId: number): RepoRecord[];
  upsertRepo(input: { installationId: number; owner: string; name: string; defaultBranch: string }): RepoRecord;
  touchRepoOpened(owner: string, repo: string): void;

  // Prefs — used in cli mode too
  getPref<T>(key: string): T | null;
  setPref<T>(key: string, value: T): void;
  // Known prefs (typed helpers — thin sugar over get/setPref):
  //   - "repos_base_dir": string | null  (default base for new clones;
  //     null falls back to `~/.tve/repos/`)

  // Recent projects (parity with services/recent-projects.ts)
  listRecentProjects(): { path: string; name: string }[];
  addRecentProject(path: string, name: string): void;
}

export function createStateStore(opts?: { dbPath?: string }): StateStore;
```

**Migrations**

`state-store-migrations.ts` exports `migrate(db: BetterSqlite3.Database)`
which runs `BEGIN TRANSACTION; <DDL>; COMMIT;` per missing version,
storing each successful run in `schema_version`. Phase 1 ships v1
only; future tables get appended without rewriting v1.

**JSON → SQLite migration for recent projects**

On first `open()`, if `recent_projects` is empty AND
`~/.tve/recent-projects.json` exists, import the JSON entries (path,
name, mtime as `last_opened_at`). One-shot. The JSON file is left in
place for backwards compatibility with older TVE versions on the same
machine.

**TVE_MODE behavior**

- `cli` mode: store opens (so prefs work), but auth-related write
  paths (`upsertAccount`, `upsertInstallation`, etc.) are exposed —
  they just have no callers in CLI.
- `desktop` mode: full read/write.

**Tests**

`packages/server/src/services/state-store.test.ts`:

- Open on a fresh tmp dir creates the file + applies v1 migration.
- Re-open is idempotent (no double-run on existing v1).
- Recent projects round-trip.
- JSON import: pre-seed `recent-projects.json` then open; entries
  appear in `listRecentProjects()`.
- Cross-platform path: test runs on Win/macOS/Linux CI.

**Risk**

Medium. `better-sqlite3` is a native module — prebuilt binaries cover
common platforms but Phase 3 binary bundling will need to vet that
the SEA build picks up the right `.node` binary per platform. Flag in
Phase 3 plan; not a blocker for Phase 1.

---

## Step 8 — Project switch extension (typed payloads)

**Files**

- Edited: `packages/server/src/routes/project.ts` — `POST /switch`
  accepts a discriminated union body.
- Edited: `packages/shared/src/types.ts` — adds
  `ProjectSwitchPayload` types.

**Contract**

```ts
// packages/shared/src/types.ts
export type ProjectSwitchPayload =
  | { kind: "local"; path: string }
  | { kind: "github"; owner: string; repo: string; ref?: string };

export interface ProjectSwitchResponse {
  path: string;
  name: string;
  hasNodeModules: boolean;
  /** Phase 2: when kind=github, surfaces clone progress events on /ws */
  source: "local" | "github";
}
```

**Phase 1 behavior**

- `kind: "local"` → existing flow (validate via Phase 1 step 9, swap
  active project).
- `kind: "github"` → returns `501 Not Implemented` with
  `{ error: "GitHub project sources are wired in Phase 2", code: "phase2-github" }`.
  Same response in both `cli` and `desktop` modes; the route body
  stays on the contract so editor work in Phase 2 doesn't change the
  API shape.

**Backwards compatibility**

The current route accepts `{ path: string }`. Keep parsing that shape
as `kind: "local"` for at least one Phase 1 → Phase 2 cycle so the
existing editor (which still sends the old payload) doesn't break.

**Tests**

Extend `packages/server/src/routes/project.test.ts` (or create if
absent) with:

- Old shape `{ path }` still works.
- New shape `{ kind: "local", path }` works identically.
- New shape `{ kind: "github", owner, repo }` returns 501 with the
  documented error code.
- Invalid `kind` → 400.

**Risk**

Low. Pure typing + dispatch work. The github branch is intentionally
inert.

---

## Step 9 — Project validator

**Files**

- New: `packages/server/src/services/project-validator.ts`
- Edited: `packages/server/src/routes/project.ts` — `POST /switch`
  swaps inline `hasAstroConfig()` for `validateLocalProject()`.

**Contract**

```ts
// services/project-validator.ts
export type ValidationFailureReason =
  | "no-astro-config"
  | "no-tailwind"
  | "unsupported-tailwind"
  | "too-large"
  | "symlink-escape";

export type ValidationResult =
  | { ok: true; tailwindVersion: 3 | 4 }
  | { ok: false; reason: ValidationFailureReason; detail: string };

export interface RemoteProbeOptions {
  owner: string;
  repo: string;
  ref?: string;
  token: string;             // Phase 2 supplies via TokenStore
  fetchImpl?: typeof fetch;  // injectable for tests
}

export function validateLocalProject(dir: string): Promise<ValidationResult>;
export function validateRemoteRepo(opts: RemoteProbeOptions): Promise<ValidationResult>;
```

**`validateLocalProject` algorithm**

1. **Symlink-escape check.** For each entry under `dir` (cap depth 5,
   skip `node_modules`/`.git`/`dist`/`.astro`), `fs.realpath` and
   reject if outside `dir`.
2. **Astro config.** Look for `astro.config.{mjs,ts,js,mts,cjs}` at
   root. None → `no-astro-config`.
3. **Tailwind detection.** Reuse `detectTailwindVersion()` from
   `services/tailwind-config.ts`:
   - Returns `{ version: 3 }` → `ok: true, tailwindVersion: 3`.
   - Returns `{ version: 4 }` → `ok: true, tailwindVersion: 4`.
   - Throws / no match → recursive search up to depth 3 for any CSS
     file containing `@import "tailwindcss"` or `@theme`. If none →
     `no-tailwind`.
4. **Size cap.** Phase 1 keeps this disabled for local folders (the
   user picked the directory themselves). The branch returns
   `too-large` only for remote repos (Phase 2). Defined here so the
   reason union doesn't change later.

**`validateRemoteRepo` algorithm (Phase 1: stub + tests)**

Phase 1 ships the function signature and its test fixtures. The
implementation can be either:

- **(Recommended)** Full implementation now — uses GitHub Contents
  API with the supplied token. Phase 2 just hooks it into
  `routes/github/repos/validate`. Pros: front-loads the algorithm,
  has tests against fixtures. Cons: needs a GitHub token in test —
  use a public repo + unauthenticated probe (60 req/h limit is fine
  for tests) or fixtures with `nock` / mocked `fetch`.
- **(Alternative)** Empty stub that throws "implement in Phase 2".
  Defers the work but adds rebase risk.

**Decision needed before implementation:** which option. Default to
recommended unless reviewer pushes back.

**Routes consuming the validator**

- `POST /api/project/switch` (kind=local) — replaces the inline
  `hasAstroConfig()` check. On `ok: false`, returns
  `400 { error, code: reason, detail }` so the editor can render a
  helpful message (Phase 2 picker UI consumes the same shape).

**Tests**

`packages/server/src/services/project-validator.test.ts` — fixtures
under `packages/server/src/services/__fixtures__/`:

| Fixture | Expectation |
|---|---|
| `astro-tw3/` (astro.config.mjs + tailwind.config.mjs) | `{ ok: true, version: 3 }` |
| `astro-tw4/` (astro.config.mjs + src/styles/global.css with @theme) | `{ ok: true, version: 4 }` |
| `astro-tw4-import/` (astro.config.mjs + CSS with `@import "tailwindcss"`) | `{ ok: true, version: 4 }` |
| `no-astro/` (just package.json + tailwind config) | `{ ok: false, reason: "no-astro-config" }` |
| `astro-no-tw/` (astro.config only) | `{ ok: false, reason: "no-tailwind" }` |
| `symlink-escape/` (a symlink that points outside the dir) | `{ ok: false, reason: "symlink-escape" }` |

Existing `test-project/` becomes the seventh implicit fixture (must
return `ok: true, version: 3`).

For `validateRemoteRepo`:
- Mock `fetch` to return Contents API responses for an
  Astro+Tailwind repo (ok), a non-Astro repo (no-astro-config), and
  a repo with no Tailwind anywhere in the first 3 dir levels.

**Risk**

Medium. The recursive CSS search for Tailwind v4 is the part most
likely to misclassify. Bound depth strictly at 3 levels and skip
`node_modules`/`.astro`/`dist` to keep it fast and predictable.

---

## Cross-cutting concerns

### TVE_MODE gating

- `cli` mode: state-store opens but no auth/installation rows ever
  written. `validateLocalProject` runs on every `/switch` (replaces
  the inline check). All other Phase 1 services exposed but unused.
- `desktop` mode: same as `cli` for Phase 1 — Phase 2 wires the
  desktop-only flows.

### Path resolution: `~/.tve/`

Single helper `services/tve-paths.ts` (small, can be in `state-store.ts`
if we want to avoid yet another file):

```ts
export function tveHome(): string {
  return process.env.TVE_HOME || path.join(os.homedir(), ".tve");
}
export function tveStateDbPath(): string;
export function tveReposBaseDir(): string;
```

Used by both repo-cache and state-store. Test override via `TVE_HOME`.

### Native dependency: `better-sqlite3`

Add to `packages/server/package.json` dependencies. Confirm:

- `pnpm install` works on Win/macOS/Linux without build-from-source
  for Node 20+ (prebuilt binaries available).
- `npx tsx src/index.ts` (the dev path) loads the `.node` binary
  correctly on Windows (the platform we develop on).
- Document the rebuild command in `CLAUDE.md` Development Commands
  in case a contributor hits a version mismatch.

Phase 3 will revisit for SEA bundling — flag, don't solve, here.

### Recent projects compatibility

`services/recent-projects.ts` becomes a thin wrapper that:

- In `cli` mode: continues writing to `recent-projects.json` (so
  users on stable CLI builds aren't surprised). Also writes to
  SQLite for forward compat — both stores stay in sync until Phase 6
  cutover, then JSON gets removed.
- In `desktop` mode: SQLite-only.

Reads always merge: SQLite first, fall back to JSON for entries not
in SQLite. The first `open()` does the one-shot JSON → SQLite import
described in step 7.

### CI guardrail (Phase 0 step 4) keeps running

Phase 0 added a CI job that boots the server in `cli` mode against
`test-project/` and parses one page. Phase 1 work must not break it.
If a Phase 1 step needs to skip something in CLI mode, that's a hint
the design is wrong — re-think before merging.

---

## Test plan summary

| Step | Test file | Coverage |
|------|-----------|----------|
| 5 | `git-transport.test.ts` | Pass-through invokes simple-git correctly; error propagation. |
| 5 | regression in `git.test.ts` | push/pull commands unchanged after refactor. |
| 6 | `repo-cache.test.ts` | Path resolution, ensureDir, lockHash round-trip, needsInstall, remove/list. |
| 7 | `state-store.test.ts` | Migrations idempotent, prefs round-trip, recent-projects JSON import, cross-platform path. |
| 8 | `routes/project.test.ts` | Old shape, new local shape, github → 501, invalid → 400. |
| 9 | `project-validator.test.ts` | Six local fixtures + remote probe mocks. |

CI matrix: Win/macOS/Linux × Node 20 LTS + Node 22 LTS.

---

## Exit criteria (from migration-plan.md, restated for tracking)

- [ ] All CLI flows work unchanged (`pnpm dev` against `test-project/`,
      load a page, edit a class, save).
- [ ] CI guardrail green on the `feat/local-saas` branch.
- [ ] Unit tests above pass on Win/macOS/Linux.
- [ ] `validateLocalProject` covers: missing astro.config, v3 config,
      v4 `@theme` CSS, neither, symlink escape.
- [ ] SQLite store opens cleanly on all three platforms.
- [ ] `git-transport` audit complete — every network git op confirmed
      routed through it.
- [ ] Repo cache honors precedence: explicit override > prefs >
      `~/.tve/repos/` default; `repos.fs_path` is recorded at clone
      time so a later base-dir change does not orphan existing
      clones.

---

## Out of scope for Phase 1 (deferred)

- GitHub App registration, OAuth routes, device flow → Phase 2.
- Token store implementations (`FileTokenStore`, `KeychainTokenStore`)
  → Phase 2 / 4.
- Repo picker UI, sign-in screen, clone progress streaming → Phase 2.
- Three-layer remote validation pipeline (only Layer-2 helper lands
  in Phase 1; Layer-1 picker call and Layer-3 preflight integration
  are Phase 2).
- Electron shell, packaging, signing → Phases 3–5.

---

## Open questions to close before starting

1. **`validateRemoteRepo` in Phase 1 vs Phase 2.** Recommend
   implementing now (with mocked tests). Sign-off needed.
2. **Recent-projects dual-write window.** OK to write to both JSON
   and SQLite in `cli` mode through Phase 1 + 2, then drop JSON at
   Phase 6 cutover? Or single-source from SQLite immediately?
3. **`better-sqlite3` version pin.** Pin to the latest stable that
   has prebuilds for Node 20 + 22. Confirm at PR review time.
4. **`tve-paths.ts` as a separate file vs inlined in `state-store.ts`.**
   Cosmetic — defer to reviewer preference.

---

## Suggested PR breakdown

Land Phase 1 as four small PRs against `feat/local-saas`, each
mergeable on its own:

1. **PR-1: project validator + route swap** (step 9). Smallest, most
   user-visible — better error messages on `/switch`.
2. **PR-2: git transport refactor** (step 5). Mechanical, easy to
   review hunk-by-hunk.
3. **PR-3: state store + paths helper** (step 7). Brings
   `better-sqlite3` in.
4. **PR-4: repo cache + project switch typing** (steps 6, 8).
   Closes Phase 1.

Each PR keeps `feat/local-saas` green and the CLI flow working. Once
all four merge and the exit criteria are checked off, Phase 1 is
complete and Phase 2 starts on the same branch.
