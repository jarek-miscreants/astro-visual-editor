# Phase 2 — Auth + Repo Provisioning: Implementation Plan

> **Status as of 2026-05-07: implemented end-to-end and verified.**
> The shape this doc describes is the shape that was built, with a few
> simplifications captured in the status table below. The full
> credential-bearing chain (OAuth sign-in → repo list → clone via
> installation token → token-scrub → install → push via injected
> installation token) was driven via the editor + Chrome DevTools and
> a real commit landed on `jarek-miscreants/astro-starter-playground`.
> **Committed and merged to `main` on 2026-06-09** (was previously
> uncommitted working-tree work on `feat/local-saas`).

## Status snapshot

| Step | Status | Notes |
|---|---|---|
| 9 — GitHub App + broker contract | ✅ Done | Personal-test App `tailwind-visual-editor` (App ID `3625760`). Broker deployed at `https://tve-broker.jarek-dbc.workers.dev`. Permissions match the original spec: contents:write, metadata:read, pull_requests:write, workflows:read. Public values documented in `docs/integration/app-config.md`; secrets only in the Worker. |
| 10 — Auth routes | ✅ Done | `routes/auth.ts` with `/github/start`, `/github/callback`, `/whoami`, `/logout`. CSRF state validated. Token persisted to `state.db` `prefs.github_user_token` (key TTL-aware) so `tsx watch` reloads don't sign the user out. |
| 11 — TokenStore | ⚠️ Simplified | Phase 2 plan called for an `AES-256-GCM`-encrypted `FileTokenStore`. Shipped: plain-JSON serialization in `state.db` `prefs`. Acceptable for `cli` mode (state.db is in the user's home dir, same trust as their `.gitconfig`). Desktop mode → OS keychain via `keytar` is captured in `docs/follow-ups.md`. |
| 12 — Repo picker API + clone pipeline | ✅ Done | `routes/github.ts` proxies `/user/installations` and `/user/installations/:id/repositories`. `services/github-clone.ts` mints an installation token via the broker, clones using URL-embedded token, scrubs `.git/config` post-clone, runs the Phase 1 validator, calls `switchProject`. Auto-installs deps via `services/dependency-installer.ts` (Corepack-routed for pnpm/yarn on Windows). |
| 13 — Token-backed git transport | ✅ Done | `createTokenGitTransport` swaps in for the ambient pass-through whenever an App is configured (not gated on `mode === "desktop"` — see deviations below). Per-call `git -c http.extraheader=Authorization: Basic …` injection. In-memory token cache by `installationId` with 60s safety margin. Falls back to ambient when `.tve-meta.json` lacks an `installationId`. Debug log line per push/pull shows which path was taken. |
| 14 — Editor screens | ⚠️ Slimmed | Built: `AuthButton` in toolbar (sign in / avatar dropdown / sign out / "Open repo from GitHub…"), `GitHubRepoPickerDialog` (installation list + repo list + branch hint + Open). Skipped for now: `SettingsPanel` (repos-base-dir override is still possible via env), full clone-progress streaming (clone is blocking with a status banner). Both are captured for follow-up. |

### Deviations from the plan worth flagging

1. **CLI mode is no longer "inert" for App auth.** The original plan
   gated every Phase 2 route on `mode === "desktop"`. Implementation
   gates on `githubAppConfig` being present instead. This means a user
   running `pnpm dev` with `.env.local` populated *can* sign in, pick a
   repo, clone, and push — without flipping to `desktop` mode. The
   payoff: the developer iteration loop is the same as the production
   loop, no `TVE_MODE=desktop` toggling needed during dev. The cost:
   the sign-in surface is reachable in `cli` mode, so a user who only
   wanted the local-path picker now sees a "Sign in" button. Mitigated
   by the fact that signing in is opt-in (the button just sits there).
2. **Token broker isn't in its own repo yet.** The plan said "out of
   band from main." Currently lives at `broker/` inside the workspace
   for ergonomic dev. Extracting is a `git mv` + new repo whenever
   we're ready (likely before the production deploy with the Miscreants
   App). Captured in `docs/follow-ups.md`.
3. **`installationId` lives in `.tve-meta.json`, not `state.db.repos`.**
   The plan put repo metadata (incl. installation linkage) in the
   `repos` SQLite table. Phase 1 schema landed with `repos` empty (no
   FKs back to a "github_account → installations" chain populated yet),
   so Phase 2 took the simpler path of recording `installationId` in
   the per-clone JSON sidecar. Migration to the SQLite table is a
   future cleanup — see follow-up "Installation schema can't represent
   org installs" in `docs/follow-ups.md`, since both items touch the
   same area.
4. **Auto-install on clone wasn't in the original plan.** Discovered
   during the first end-to-end test (Astro dev server failed because
   `astro/config` wasn't installed). Added `services/dependency-installer.ts`
   to bridge the gap; lockfile-hash bookkeeping in `repo-cache.ts`
   means re-opens skip the install when nothing's changed.
5. **OS keychain (Phase 4) deferred.** Server-token persistence is
   in `state.db` for now. Acceptable for cli mode; desktop mode should
   move to keychain before any external user gets a build.

### What's verified end-to-end (2026-05-07)

Driven via Chrome DevTools MCP + real GitHub:

1. Click "Sign in" → browser → github.com OAuth → callback → token
   stored. Verified `whoami` returns user info.
2. Open repo picker → installations populated (1 install:
   `jarek-miscreants`) → repos populated (1 repo:
   `astro-starter-playground`).
3. Click "Open" → broker mints installation token (1h TTL) → clone
   completes → token scrubbed from `.git/config` → 420 npm packages
   installed in 7s → Astro dev server starts → editor preview iframe
   renders the live page (full layout, components, images).
4. Make an in-editor mutation (text edit) → working tree dirty → click
   Publish → server log: `[git-transport] push via App installation
   token` → commit lands on `jarek-miscreants/astro-starter-playground`
   on github.com.

The user's Windows Credential Manager / SSH keys / `~/.gitconfig` were
not consulted at any step in (2)–(4).

### Test counts at the time of writing

- Server: **240** passing across 17 files
- Broker: **44** passing across 4 files
- Editor: typecheck-only, all clean

---

(Original implementation plan follows. Treat the snapshot above as the
load-bearing summary; the rest of this document is the original
specification kept as historical context.)

---

Original status: draft for review — do not implement until Phase 1 is complete
and prerequisites below are met.

Companion to `migration-plan.md` Phase 2 (steps 9–14) and the
locked decisions in `phase-0-decisions.md`. This is the most complex
phase: external GitHub App registration, an out-of-band token broker,
two auth flows, token lifecycle, repo provisioning with progress
streaming, the three-layer validation pipeline, and four new editor
screens — all working in a browser pointed at `pnpm dev`, no Electron.

## Phase 2 scope (one-line summary per step)

| # | Step | New files | Touched files |
|---|------|-----------|---------------|
| 9 | GitHub App + broker contract | `docs/integration/github-app.md` | (no code in main repo) |
| 10 | Auth routes | `routes/auth.ts`, `services/auth-state.ts`, `services/github-broker-client.ts` | `index.ts` |
| 11 | TokenStore | `services/token-store.ts`, `services/file-token-store.ts` | `services/state-store.ts` (read pref) |
| 12 | Repo picker API + clone pipeline | `routes/github.ts`, `services/github-client.ts`, `services/clone-pipeline.ts` | `routes/project.ts` (kind=github branch) |
| 13 | Token-backed git transport | `services/git-transport-token.ts` | `services/git-transport.ts` (factory swap), `index.ts` |
| 14 | Editor screens | `components/auth/SignInScreen.tsx`, `components/repo-picker/RepoPicker.tsx`, `components/repo-picker/CloneDialog.tsx`, `components/repo-picker/CloneProgress.tsx`, `components/settings/SettingsPanel.tsx`, `store/auth-store.ts`, `store/repo-store.ts` | `App.tsx`, `Toolbar.tsx`, `EditorLayout.tsx` |

## Guiding constraints

- **CLI mode stays inert.** Every new route 404s in `cli` mode; every
  new editor screen mounts only when `/api/project/info` reports
  `mode === "desktop"`. The existing local-path picker keeps working.
- **Token broker is out-of-band.** It lives in its own repo
  (`tve-token-broker` or similar). This plan specifies its API
  contract and how TVE consumes it; the broker's source code is not
  in scope here.
- **No Electron-specific code.** Deep links, OS keychain, and
  `BrowserWindow` are Phase 4. Phase 2 must work end-to-end in a
  browser pointed at `localhost:3005`.
- **Tokens never touch disk in plain text.** `FileTokenStore` is
  AES-256-GCM-encrypted; `KeychainTokenStore` (Phase 4) replaces it.
  Logs scrub tokens via `lib/log-redact.ts` at every call site.
- **Single source of truth for "is this project compatible?"** —
  `validateLocalProject` and `validateRemoteRepo` from Phase 1.
  Phase 2 wires them into three layers but does not re-implement the
  rules.

## Prerequisites (must complete before starting Phase 2)

These must all be done before PR-5 lands, because Phase 2 PRs depend
on each of them:

1. **Phase 1 fully merged** — PR-1 (validator) ✓, PR-2 (git-transport),
   PR-3 (state-store + SQLite), PR-4 (repo-cache + switch typing).
2. **GitHub App registered** with the permissions in step 9 below.
   App ID, App slug, and public key documented in
   `docs/integration/github-app.md` (new file). Private key NOT
   committed.
3. **Token broker deployed** to its production URL. Health-checks
   against the contract in step 9. URL configured via
   `TVE_BROKER_URL` env var (no hardcoded URLs).
4. **Mode flag exercised end-to-end** — boot the server with
   `TVE_MODE=desktop` and confirm `/api/project/info` reports it.
   Already done in Phase 0; spot-check before starting.

If any prerequisite is missing, do NOT start Phase 2 — stub work
will create rebase pain.

---

## Step 9 — GitHub App + token broker contract

**No code change in this repo.** Two deliverables:

### 9.1 GitHub App registration

Owner: project owner (personal account or org — see
`phase-0-decisions.md` §1 follow-up).

Required permissions (set on the App, requested per-installation):

| Permission | Access | Why |
|---|---|---|
| Repository contents | Read & write | Read source files, push commits |
| Repository metadata | Read | List user's repos in the picker |
| Pull requests | Read & write | Phase 2.5 / future PR-creation flow |
| Workflows | Read | Detect CI configs (informational, optional) |

User-level OAuth scopes (in addition to App permissions):

- `read:user` — display name + avatar in UI
- `user:email` — for git author info on commits

Webhook URL: **none.** TVE doesn't subscribe to events.

Callback URLs:

- `http://localhost:3011/api/auth/github/callback` — Phase 2 dev mode
- `tve://auth/callback` — Phase 4 (registered now so we don't need
  to re-register the App later)

Output: `docs/integration/github-app.md` with App ID, slug,
permissions list, and step-by-step "how to install on a repo"
instructions for end users.

### 9.2 Token broker contract

The broker holds the App private key and exchanges secrets so TVE
never has to. It's a single-purpose Cloudflare Worker (recommended)
or AWS Lambda. **Source lives in a separate repo.**

API contract:

```
POST {TVE_BROKER_URL}/exchange-code
Request:  { code: string, state: string, redirectUri: string }
Response: 200 { userToken: string, expiresAt: number, accountLogin: string, githubId: number }
          400 { error: "invalid_code" | "redirect_mismatch" }

POST {TVE_BROKER_URL}/mint-installation-token
Request:  { installationId: number, userToken: string }
Response: 200 { installationToken: string, expiresAt: number }
          401 { error: "user_token_invalid" }
          403 { error: "user_not_authorized_for_installation" }

GET  {TVE_BROKER_URL}/health
Response: 200 { ok: true, version: string }
```

The broker:

- Holds App private key (encrypted at rest, e.g. CF Worker secrets)
- Never persists tokens — proxies, then forgets
- Rate-limits per `userToken` to prevent abuse
- CORS allow-list: `http://localhost:*` (dev), `tve://*` (Electron),
  optionally an explicit production app origin

**Decision needed:** hosting (Cloudflare Workers vs AWS Lambda).
Recommendation: **Cloudflare Workers** — cheaper, no cold start,
simpler secrets model, free tier covers expected volume.

---

## Step 10 — Auth routes

**Files**

- New: `packages/server/src/routes/auth.ts`
- New: `packages/server/src/services/auth-state.ts` — in-memory CSRF
  state store
- New: `packages/server/src/services/github-broker-client.ts` — typed
  client for the broker contract
- Edited: `packages/server/src/index.ts` — mount `/api/auth/github`

**Routes**

```
POST   /api/auth/github/start
  Body: {}  (mode === "desktop" required)
  Returns: { authorizeUrl: string, state: string }
  Side effect: registers `state` in auth-state with 10min TTL

GET    /api/auth/github/callback?code=...&state=...
  No auth required. Validates state, calls broker /exchange-code,
  persists user token via TokenStore, broadcasts ws { type: "auth:complete" }.
  Returns: HTML that calls window.close() (the popup case) or 302 to /
           (the same-tab case — flag via ?return=...)

POST   /api/auth/github/device
  Body: {}
  Returns: { userCode: string, verificationUri: string, deviceCode: string, interval: number }

POST   /api/auth/github/device/poll
  Body: { deviceCode }
  Returns: { state: "pending" | "complete" | "expired" | "denied", token?, error? }

DELETE /api/auth/github/session
  No body. Clears the user token + broadcasts ws { type: "auth:signout" }.
  Returns: { success: true }
```

**Auth-state CSRF store**

```ts
interface AuthStateEntry {
  state: string;
  createdAt: number;
  redirectUri: string;
  used: boolean;
}

export interface AuthStateStore {
  create(redirectUri: string): AuthStateEntry;
  consume(state: string): AuthStateEntry | null;
  /** Sweeper — runs every 60s to drop entries older than 10min. */
  start(): void;
  stop(): void;
}
```

In-memory only. State is single-use; `consume()` marks it `used` and
returns it once. Subsequent calls with the same state return null.

**Broker client**

```ts
export interface GithubBrokerClient {
  exchangeCode(input: { code: string; state: string; redirectUri: string }): Promise<{
    userToken: string;
    expiresAt: number;
    accountLogin: string;
    githubId: number;
  }>;
  mintInstallationToken(input: { installationId: number; userToken: string }): Promise<{
    installationToken: string;
    expiresAt: number;
  }>;
}

export function createGithubBrokerClient(opts: { brokerUrl: string; fetchImpl?: typeof fetch }): GithubBrokerClient;
```

Constructed once at server boot. `brokerUrl` is `process.env.TVE_BROKER_URL`
in production; tests pass a mocked fetchImpl.

**TVE_MODE gating**

All routes refuse with `404 { error: "desktop_mode_only" }` when
`app.locals.mode === "cli"`. This applies to every route in steps
10–12.

**Tests**

`packages/server/src/routes/auth.test.ts`:

- `/start` returns an authorize URL containing the registered state.
- `/callback` with valid state + mocked broker → token persisted,
  `auth:complete` WS broadcast.
- `/callback` with mismatched state → 400 invalid_state.
- `/callback` with reused state → 400 expired_state.
- `/device/poll` happy path: pending → complete with token.
- `/session` DELETE clears the token.
- All routes return 404 in cli mode.

**Risk**

Medium. State management is the easy-to-get-wrong part. Use a
single-use store with TTL; never re-use state.

---

## Step 11 — TokenStore

**Files**

- New: `packages/server/src/services/token-store.ts` — interface +
  factory
- New: `packages/server/src/services/file-token-store.ts` —
  encrypted-file impl
- Edited: `packages/server/src/services/state-store.ts` — adds
  `prefs.token_store_kind` known key (default "file" in desktop, none
  in cli)

**Interface**

```ts
export interface UserTokenRecord {
  token: string;
  expiresAt: number;
  accountLogin: string;
  githubId: number;
}

export interface InstallationTokenRecord {
  token: string;
  expiresAt: number;
}

export interface TokenStore {
  getUserToken(): Promise<UserTokenRecord | null>;
  setUserToken(record: UserTokenRecord): Promise<void>;
  clearUserToken(): Promise<void>;
  getInstallationToken(installationId: number): Promise<InstallationTokenRecord | null>;
  setInstallationToken(installationId: number, record: InstallationTokenRecord): Promise<void>;
  clearInstallationTokens(): Promise<void>;
}

export function createTokenStore(opts: {
  kind: "file" | "keychain";
  brokerClient?: GithubBrokerClient; // for mint-on-demand
}): TokenStore;
```

**File backend**

`~/.tve/tokens.enc` — AES-256-GCM, key derived via PBKDF2 from:

- `os.userInfo().username`
- `os.hostname()`
- A per-install salt stored in `prefs.token_store_salt` (32 random
  bytes generated on first init, persisted to state.db)

**This is not strong protection against a local attacker.** Local
malware running as the user can recompute the key. The intent is to
prevent casual disk inspection / accidental sharing of the file. The
plan and CHANGELOG must call this out explicitly. `KeychainTokenStore`
(Phase 4) is the production answer.

File format (after decryption):

```json
{
  "user": { "token": "...", "expiresAt": 1717000000000, "accountLogin": "...", "githubId": 12345 },
  "installations": {
    "789": { "token": "...", "expiresAt": 1717003600000 }
  }
}
```

Atomic write: `tokens.enc.tmp` → `fs.rename` → `tokens.enc`.

**Mint-on-demand**

`getInstallationToken(id)` does:

1. Read from store. If present and `expiresAt > now + 5min`, return it.
2. If absent or near-expiry, call `brokerClient.mintInstallationToken`.
   Persist + return.
3. If broker fails, return the cached token (even if near-expiry) so
   the caller can attempt — git will surface a 401 if it really is
   expired.

**Tests**

- File round-trip: write user token, read it back identical.
- Encryption: file on disk is unreadable as JSON.
- Atomic write: simulated crash between tmp and rename leaves the
  old file intact.
- Expiry: getUserToken returns null when expired.
- Mint-on-demand: cached fresh token returned without broker call;
  near-expiry triggers refresh.

**Risk**

Medium. Encryption/key-derivation bugs are easy to write and hard to
spot. Use a vetted approach (PBKDF2 + AES-GCM via Node's `crypto`
module) and a code review sign-off.

---

## Step 12 — Repo picker API + clone pipeline

This is the largest step. Split into three sub-modules.

### 12.1 GitHub API client

**File:** `packages/server/src/services/github-client.ts`

Wraps fetch calls to `api.github.com` with the appropriate token
(user vs installation) and rate-limit awareness.

```ts
export interface InstallationSummary {
  id: number;
  accountLogin: string;
  accountAvatarUrl: string;
  repositorySelection: "all" | "selected";
}

export interface RepoSummary {
  owner: string;
  name: string;
  defaultBranch: string;
  sizeKb: number;
  isPrivate: boolean;
  pushedAt: number;
}

export interface GithubClient {
  listInstallationsForUser(userToken: string): Promise<InstallationSummary[]>;
  listReposForInstallation(installationId: number, installationToken: string): Promise<RepoSummary[]>;
  getRepoMetadata(owner: string, name: string, installationToken: string): Promise<RepoSummary>;
  /** For Phase 1 validateRemoteRepo's recursive CSS probe. */
  getContents(owner: string, name: string, path: string, ref: string | undefined, installationToken: string): Promise<ContentsEntry[]>;
}
```

Rate-limit handling: read `X-RateLimit-Remaining` header; if 0, throw
`GithubRateLimitError(resetAt)`. Caller surfaces as a structured
error to the client.

### 12.2 Repo picker routes

**File:** `packages/server/src/routes/github.ts`

```
GET  /api/github/installations
  Returns: InstallationSummary[]
  Errors: 401 if no user token

GET  /api/github/installations/:id/repos
  Returns: { repos: (RepoSummary & { validation: ValidationResult })[] }
  Side effect: validates each repo via Phase 1's validateRemoteRepo
  Cached for 60s per installation

GET  /api/github/repos/validate?owner=&repo=&ref=
  Returns: ValidationResult
  No cache — runs on every branch switch in the picker

POST /api/github/clone
  Body: { owner, repo, ref?, destBase? }
  Returns: 202 { jobId: string }
  Streams progress on /ws as { type: "github:clone-progress", jobId, state, detail? }
  See clone pipeline (12.3)

DELETE /api/github/clone/:jobId
  Cancels an in-progress clone. Tears down the partial dir.
```

All routes 404 in cli mode.

### 12.3 Clone + install pipeline

**File:** `packages/server/src/services/clone-pipeline.ts`

State machine:

```
queued → cloning → validating-fs → installing → ready
                       ↓               ↓          ↓
                    failed         failed     failed
                  (incompatible) (install)  (rare runtime)
```

Each state transition broadcasts to `/ws`:

```ts
type CloneProgress = {
  type: "github:clone-progress";
  jobId: string;
  owner: string;
  repo: string;
  state: "queued" | "cloning" | "validating-fs" | "installing" | "ready" | "failed" | "cancelled";
  detail?: string;          // human-readable, e.g. "Receiving objects: 45%"
  reason?: ValidationFailureReason | "clone_failed" | "install_failed" | "network_error" | "disk_full";
};
```

Pipeline steps:

1. **queued.** Resolve `destBase` (from request → prefs → default).
   Compute `destPath = {destBase}/{owner}/{repo}`. Reject if
   `repos.fs_path` already exists for `(owner, repo)` in state.db
   (per `phase-0-decisions.md` §4 edge case).
2. **cloning.** `gitTransport.clone(repoUrl, destPath, ["--depth", "50"])`.
   Stream simple-git progress events to WS.
3. **validating-fs.** Run `validateLocalProject(destPath)`. On
   failure: stop, leave dir intact, emit `failed` with the
   `ValidationFailureReason`.
4. **installing.** Detect package manager (lockfile presence in
   priority order: pnpm > npm > yarn). Spawn install. Stream stdout
   to WS as `detail`. On non-zero exit: emit `failed`.
5. **ready.** Compute lockHash via `repoCache.recordLockHash`. Insert
   `repos` row with `fs_path` set to `destPath`,
   `installation_id` from the picker context. Emit `ready`. Caller
   typically follows with `POST /api/project/switch` to open it.

**Cancellation:** `DELETE /clone/:jobId` sets the pipeline's `cancelled`
flag; the in-flight step exits at the next safe checkpoint and the
partial dir is removed.

**Concurrency:** at most one active clone at a time per project
context. Queue subsequent requests (rare in normal use).

**Tests**

- API client: rate-limit header parsing, fetch error mapping.
- Clone pipeline: happy-path mock (mock simple-git + mock install).
- Validation reject mid-clone: post-clone fs check fails, dir is
  left intact, no install runs.
- Cancellation: kill mid-clone, dir is removed, ws emits
  `cancelled`.
- Three-layer enforcement: pre-clone API mock rejects → never
  cloned; pre-clone passes but post-clone fails (Contents API
  lagged) → cloned but not installed; both pass but
  astro-sync-preflight fails → installed but `astro dev` is blocked
  by Phase 1's preflight (existing behavior).

**Risk**

High. Most moving parts. Stream-buffering in WS messages is the most
likely source of subtle bugs (lost lines, out-of-order). Buffer per-
job and flush on state transitions.

---

## Step 13 — Token-backed git transport

**Files**

- New: `packages/server/src/services/git-transport-token.ts`
- Edited: `packages/server/src/services/git-transport.ts` — exports
  a factory that picks the impl based on mode + TokenStore presence
- Edited: `packages/server/src/index.ts` — wires the token transport
  in desktop mode, ambient in cli mode

**Behavior**

For each `push/pull/fetch/clone`:

1. Look up `installation_id` for the repo (state.db `repos.installation_id`).
2. `tokenStore.getInstallationToken(installation_id)` (mint-on-demand).
3. Inject via `-c http.extraheader="Authorization: token {token}"`.
4. Never write to `.git/config`. The `-c` flag is per-invocation only.
5. After clone, scrub remote URL: `git remote set-url origin {url-without-creds}`.
   (The url passed to clone shouldn't have creds in the first place
   — we use `Authorization` headers — but defensive scrub anyway.)

**Token forwarding to git's child process**

`simple-git` doesn't expose `-c` directly per-call; pass via the
`config` option (`{ config: ["http.extraheader=..."] }`). Confirmed
in `simple-git` docs.

**Logging redaction**

Token strings are redacted in any log line that goes through
`lib/log-redact.ts`. The transport never logs the token directly,
but a future contributor might log the spawned `git` command's args.
Redaction is the safety net.

**Tests**

- Mock simple-git, assert `-c http.extraheader` is set with the
  expected header per call.
- Token rotation: when `getInstallationToken` returns a new token,
  the next call uses it.
- Cli mode: ambient transport is selected (no token injection).

**Risk**

Medium. The header injection is straightforward; the audit (every
network call routes through transport) is the hard part — already
done in Phase 1 PR-2.

---

## Step 14 — Editor screens

Six new files, three Zustand stores.

### 14.1 Stores

```ts
// store/auth-store.ts
interface AuthStore {
  status: "loading" | "signed-out" | "signed-in";
  user: { login: string; avatarUrl: string } | null;
  startOAuth(): Promise<void>;
  startDeviceFlow(): Promise<{ userCode: string; verificationUri: string }>;
  pollDeviceFlow(deviceCode: string): Promise<void>;
  signOut(): Promise<void>;
}

// store/repo-store.ts
interface RepoStore {
  installations: InstallationSummary[];
  reposByInstallation: Record<number, (RepoSummary & { validation: ValidationResult })[]>;
  loadInstallations(): Promise<void>;
  loadRepos(installationId: number): Promise<void>;
  // Clone progress
  activeJob: { jobId: string; state: CloneState; detail?: string } | null;
  startClone(input: { owner: string; repo: string; ref: string; destBase?: string }): Promise<void>;
  cancelClone(): Promise<void>;
}

// store/settings-store.ts (lighter)
interface SettingsStore {
  reposBaseDir: string | null;            // null = use default
  defaultReposBaseDir: string;            // ~/.tve/repos resolved
  loadPrefs(): Promise<void>;
  setReposBaseDir(path: string | null): Promise<void>;
}
```

### 14.2 SignInScreen

`components/auth/SignInScreen.tsx`

- Mounts when `mode === "desktop"` AND `authStore.status === "signed-out"`.
- Two CTAs:
  - **Sign in with GitHub** → `authStore.startOAuth()` → opens
    `authorizeUrl` in a popup. Backend's `/callback` calls
    `window.opener.postMessage("tve-auth-complete", "*")` and closes
    itself. Parent listens, refreshes auth state, dismisses screen.
  - **Use a device code** → calls `/device`, shows `userCode +
    verificationUri`, polls every `interval` seconds, dismisses on
    `state === "complete"`.
- Shows the broker URL in small text so users know where their code
  goes.

### 14.3 RepoPicker

`components/repo-picker/RepoPicker.tsx`

- Mounts when signed in AND no active project (or via "Open another
  project" toolbar button → routes to picker instead of local-folder
  dialog when in desktop mode).
- Sidebar: list of installations with avatars + counts.
- Main: list of repos for the selected installation. Each row:

  ```
  [avatar] owner/repo                   [✓ Astro + Tailwind v3]
                                    or  [✗ No astro.config]   (greyed out)
  ```

- Click a compatible repo → opens CloneDialog.
- Fuzzy search filters by `owner/name`.

### 14.4 CloneDialog

`components/repo-picker/CloneDialog.tsx`

Implements `phase-0-decisions.md` §4:

```
┌───────────────────────────────────────────┐
│  Clone {owner}/{repo}                     │
│  Branch: {default} ▾                      │
│                                           │
│  Save to: {resolved path}                 │
│           [ Change… ]                     │
│                                           │
│  [ Cancel ]              [ Clone ]        │
└───────────────────────────────────────────┘
```

- Branch dropdown loads from `getRepoMetadata` + a separate
  `/branches` call (TBD — may inline if cheap).
- `[Change…]` opens an OS folder picker. In dev (browser), this is
  a text input + "Validate" button (no native picker available in
  pure browser); in Phase 4 (Electron), it's `dialog.showOpenDialog`.
- Clicking Clone calls `repoStore.startClone(...)` and dismisses.

### 14.5 CloneProgress

`components/repo-picker/CloneProgress.tsx`

Mounts when `repoStore.activeJob !== null`. Modal overlay with:

- Repo identity + branch
- State indicator (queued → cloning → validating → installing → ready)
- Detail line (last `detail` from WS)
- Cancel button (calls `repoStore.cancelClone()`)
- On `ready`: dismisses + triggers `editorStore.openProject({ kind: "github", owner, repo })`.
- On `failed`: stays open with error detail + dismiss button.

### 14.6 SettingsPanel

`components/settings/SettingsPanel.tsx`

Triggered by a gear icon in the toolbar (desktop mode only).

- Section "Project storage":
  - Default location: `{resolved path}` with `[Change default…]`.
  - List of cached repos (from `state.db repos`):
    - `owner/repo` at `{fs_path}` → `[Open]` `[Move clone…]` `[Remove from list]`
  - Move-clone is **deferred** — Phase 2 ships the UI as a
    placeholder ("Coming in v0.2") to validate the layout. Full impl
    can land in a Phase 2.5 follow-up PR.
- Section "Account":
  - User avatar + login
  - `[Sign out]`

### 14.7 Toolbar + App.tsx integration

- `Toolbar.tsx` gets a gear icon (desktop mode only) → opens
  `SettingsPanel`.
- `App.tsx` boots the auth store and conditionally mounts
  `SignInScreen` based on `mode + authStore.status`.
- `EditorLayout.tsx` mounts `RepoPicker` when no project is open and
  user is signed in (replaces / alongside the existing local-path
  picker dialog).

**Tests**

Editor-side tests are mostly E2E. Vitest unit coverage for stores:

- `authStore`: state transitions on OAuth happy path, on cancel, on
  device-flow expire.
- `repoStore`: WS message handling for clone progress, cancel.
- `settingsStore`: default vs custom base dir round-trip.

Manual E2E (the migration plan's exit criterion): browser at
`localhost:3005`, `TVE_MODE=desktop`, sign in via GitHub, pick a
repo, clone it, edit visually, push back.

**Risk**

Medium. UI work is mostly mechanical; the WS-driven progress overlay
is the most likely source of bugs (race conditions on unmount,
duplicate jobIds, reconnect handling).

---

## Cross-cutting concerns

### Error code taxonomy

A flat namespace, used in JSON error responses and WS messages:

| Code | Where | Meaning |
|---|---|---|
| `desktop_mode_only` | all new routes | Refused in cli mode |
| `not_signed_in` | github/* | No user token |
| `invalid_state` | auth/callback | CSRF state mismatch |
| `expired_state` | auth/callback | State already used or older than 10min |
| `broker_unreachable` | auth, mint | Token broker is down |
| `github_denied` | auth | User declined consent |
| `github_rate_limit` | github/* | API rate limit hit, includes `resetAt` |
| `no-astro-config` | clone, validate | Phase 1 validator |
| `no-tailwind` | clone, validate | Phase 1 validator |
| `unsupported-tailwind` | clone, validate | Phase 1 validator (e.g. v5 future) |
| `too-large` | clone, validate | Phase 1 validator |
| `symlink-escape` | clone, validate | Phase 1 validator |
| `clone_failed` | clone | git clone non-zero exit |
| `install_failed` | clone | pnpm/npm/yarn install failed |
| `network_error` | clone, mint | Underlying transport error |
| `disk_full` | clone | OS reported ENOSPC |
| `repo_already_cached` | clone | (owner, repo) already in `repos.fs_path` |

### Token redaction in logs

`lib/log-redact.ts`:

```ts
export function redactTokens(s: string): string;
```

Matches `gh[oprsu]_[A-Za-z0-9_]{36,}` and replaces with
`<redacted>`. Wired into the dev-server log forwarder
(`routes/dev-server.ts` already broadcasts logs over WS) and any
new server-side console.log call sites in Phase 2.

### CSP additions

`phase-0-decisions.md` §3 already locked the editor shell CSP. Phase 2
adds:

- `connect-src 'self' https://api.github.com {TVE_BROKER_URL}` —
  needed for the editor to call broker for device-flow polling and
  for the validator's recursive Contents API probes (which run in the
  backend, but defensive). Actually — all GitHub calls run from the
  backend, so the editor's CSP only needs `'self'`. Confirm at PR
  review.

### CLI compatibility checklist (re-stated)

- All new routes 404 in cli mode.
- TokenStore not initialized in cli mode.
- New editor screens not mounted when `mode === "cli"`.
- Existing local-path picker dialog stays the entry point in cli mode.
- No SQLite tables required for cli mode operation (auth/installations/repos
  rows simply don't exist; cli reads/writes only `prefs` + `recent_projects`).

### Branch hygiene

- Rebase onto `main` weekly (Phase 1 PRs land on main behind the flag,
  per `migration-plan.md` branch hygiene).
- Each Phase 2 PR keeps `feat/local-saas` green with
  `pnpm dev` against `test-project/` in cli mode.
- The token broker repo is independent — its versioning is decoupled.

---

## Test plan summary

| Step | Test files | Coverage |
|------|------------|----------|
| 9 | (no code) | Manual: GitHub App registration verified, broker `/health` returns ok. |
| 10 | `auth.test.ts`, `auth-state.test.ts`, `github-broker-client.test.ts` | OAuth round-trip with mocked broker, device flow, state CSRF, cli-mode 404s. |
| 11 | `token-store.test.ts`, `file-token-store.test.ts` | Encryption round-trip, atomic write, expiry, mint-on-demand. |
| 12 | `github-client.test.ts`, `clone-pipeline.test.ts`, `routes/github.test.ts` | API rate-limit, clone happy path, validation reject, cancellation, three-layer enforcement. |
| 13 | `git-transport-token.test.ts` | Header injection, token rotation, ambient fallback. |
| 14 | Store unit tests + manual E2E | Stores: state transitions. E2E: full flow per migration-plan exit criterion. |

CI matrix: Win/macOS/Linux × Node 20 LTS + Node 22 LTS. The clone
pipeline's `pnpm install` step needs network in CI — gate behind a
flag (`TVE_E2E=1`) so the default CI run doesn't depend on it.

---

## Exit criteria (from migration-plan.md, restated for tracking)

- [ ] In a browser at `localhost:3005` with `TVE_MODE=desktop`,
      sign in via GitHub, pick a repo, clone it, edit visually,
      push back. No Electron.
- [ ] CLI mode (`TVE_MODE=cli` or default) is unchanged: `pnpm dev`
      against `test-project/` still works exactly as before.
- [ ] Three-layer validation: pre-clone API probe rejects a
      non-Astro repo, post-clone filesystem rejects when Contents
      API lagged, branch switch to a missing-config branch is blocked.
- [ ] Size-cap and symlink-escape rejections covered.
- [ ] `phase-0-decisions.md` §4 cache directory UX works: default,
      override via `[Change…]`, sticky pref, per-clone tracking via
      `repos.fs_path`.
- [ ] Token redaction confirmed: a `git push` with debug logging on
      does not leak the installation token to any log surface.

---

## Out of scope for Phase 2 (deferred)

- **Move clone…** full implementation — UI lands, backend is a
  placeholder. Phase 2.5 follow-up PR.
- **PR creation flow** — Phase 2 lands push but not "open PR".
  Migration-plan flagged as new work (P2 finding); slot into
  Phase 2.5 or 3 depending on demand.
- **Webhook subscriptions** — TVE doesn't subscribe.
- **`KeychainTokenStore`** — Phase 4. `FileTokenStore` is the
  Phase 2 default.
- **Deep links (`tve://`)** — Phase 4. OAuth callback in Phase 2 is
  the localhost backend.
- **Multi-account support** — single GitHub account per TVE install
  in Phase 2. Multi-account is a Phase 3+ enhancement if anyone
  asks.

---

## Open questions to close before starting

1. **Broker hosting** — Cloudflare Workers vs AWS Lambda. Recommend
   **Cloudflare Workers**. Decide before step 9.
2. **Broker URL strategy** — single prod URL hardcoded as the
   `TVE_BROKER_URL` default, or always require the env var? Recommend
   **hardcode prod default + allow override** so day-1 users don't
   need extra config.
3. **OAuth window UX** — same-tab redirect vs popup. Recommend
   **popup** in browser dev (matches future Electron `BrowserWindow`
   child semantics; same-tab redirect can lose editor state on
   refresh).
4. **Repo picker default sort** — `pushedAt` desc (most recently
   active) vs alphabetical. Recommend **pushedAt desc** — matches
   Cursor/VSCode "recent repos" default.
5. **Auto-reauth on expired token** — when a 401 surfaces from
   GitHub, transparently reopen `SignInScreen` and resume the
   previous action? Recommend **yes** — better UX than a toast.
   Implement via a `RetryAfterAuth` error type bubbled up from
   `github-client.ts`.
6. **Move clone… cutoff** — ship Phase 2 with placeholder UI, or
   block on full implementation? Recommend **placeholder UI** so
   Phase 2 doesn't grow further. The default-base setting is
   sufficient for v0.x.
7. **WS reconnection on clone in progress** — if the editor reloads
   mid-clone, does the pipeline keep running? Recommend **yes** —
   pipeline lives on the server, editor reconnects to `/ws` and
   asks for the active job state via a new
   `GET /api/github/clone/active`. Adds a small endpoint but
   prevents lost progress.

---

## Suggested PR breakdown

Phase 2 is large enough to warrant 6 PRs. Each lands on
`feat/local-saas` and keeps the branch green:

1. **PR-5: GitHub App + broker docs** (step 9). No code in main repo.
   Documents App ID/permissions, broker contract, deployment.
2. **PR-6: TokenStore + auth routes** (steps 10, 11). Includes the
   broker client, in-memory state store, encrypted file backend,
   `/api/auth/github/*` routes.
3. **PR-7: Token-backed git transport** (step 13). Builds on PR-2's
   git-transport refactor + PR-6's TokenStore.
4. **PR-8: GitHub API client + repo picker routes** (step 12.1, 12.2).
   No clone pipeline yet.
5. **PR-9: Clone + install pipeline** (step 12.3). The high-risk
   piece. Lands behind a feature flag (`TVE_FEATURES=clone-pipeline`)
   so it can ship dark for testing.
6. **PR-10: Editor screens** (step 14). Sign-in, picker, clone dialog,
   progress, settings. Wires everything end-to-end. Removes the
   feature flag from PR-9 once E2E passes.

Total estimate: ~1 week per PR-6 through PR-9, ~1 week for PR-10
(UI bulk). Plus 2–3 days for PR-5 (App registration + broker
deployment lead time).

If desktop work stalls anywhere, `feat/local-saas` is still a
stronger CLI tool than `main` was before Phase 1 — the safety net
holds.
