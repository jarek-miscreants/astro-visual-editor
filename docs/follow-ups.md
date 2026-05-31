# Follow-ups & Known Issues

Tracking review findings that aren't fixed yet, plus a short tail of fixed
ones for context. Each entry has enough detail that the fix is obvious
when someone comes back to it — code pointers, the symptom, why it
matters, and a concrete fix shape.

**Severity ladder**

| | Meaning |
|---|---|
| **P1** | Blocks a downstream phase, or a real correctness/security bug. Fix before that phase lands. |
| **P2** | Real but recoverable. Degraded UX, defense-in-depth gap, or a comment-vs-code mismatch. |
| **P3** | Cosmetic, future cleanup, or a stylistic improvement. Safe to defer indefinitely. |

When fixing an item: leave the entry, add **Fixed: `<commit-sha>` (`<short message>`)** to the bottom. Don't delete — the history of *what we decided not to do* is as useful as the issues themselves.

---

## P1 — Open

### Broker mints installation tokens with no caller authentication

- **Where:** `broker/src/index.ts` — `handleInstallationToken(env, origin, installationIdStr)` (route match `index.ts:68-73`, handler `:207-265`).
- **Symptom:** The handler takes **no `userToken`** and only validates `Number.isInteger(installationId)`. It signs an App JWT and mints a real `contents:write` installation access token for whatever numeric ID is in the path. The only gate is the CORS `ALLOWED_ORIGINS` check, which the broker's own header comment (`index.ts:13-16`) correctly notes is *not* a security boundary — `Origin` is trivially spoofed by any non-browser caller (curl, the server, an attacker). Installation IDs are small sequential integers and are returned in plaintext by `GET /api/github/installations`.
- **Why it matters:** Anyone who learns the Worker URL can enumerate IDs and mint write-scoped tokens to every repo the App is installed on. This defeats the entire "broker is the only place secrets live" premise (`phase-0-decisions.md` §1) — you no longer need the App private key, the open endpoint hands out its power. The planned contract (`phase-2-plan.md` §9.2) required `{ installationId, userToken }` and a `403 user_not_authorized_for_installation` check; the implementation dropped both.
- **Fix shape:**
  - Add a broker-shared secret (`wrangler secret put BROKER_SHARED_SECRET`, matching env var on the TVE server) and require `Authorization: Bearer <secret>` on both `/oauth/exchange` and `/installations/:id/token`.
  - Additionally verify the installation belongs to the requesting user: take the `userToken` back, call `GET /user/installations`, and confirm the `installationId` is in the list before minting. Restores the §9.2 contract.
  - Land this **before the production Miscreants App deploy** — couple with the broker-extraction follow-up (same file moves).
- **Fixed (working tree, uncommitted):** `broker/src/index.ts` `handleInstallationToken` now requires a `userToken` in the body, calls `GET /user/installations?per_page=100` with it, and returns `401 user-token-invalid` / `403 user-not-authorized-for-installation` unless the caller actually has the installation before minting. Server side: `services/installation-token-source.ts` gained a `getUserToken` option (wired to `getCurrentAccessToken` in `index.ts`) and sends the user token in the POST body; it returns null (→ ambient git auth) when signed out. Tests: broker `index.test.ts` + `installation-token-source.test.ts` updated, all green. Still open: optional broker-shared-secret as further defense-in-depth, and the membership check is page-1-of-100 only (a user with >100 installations could false-403 — rare).

### OAuth `state` CSRF check is bypassable

- **Where:** `packages/server/src/routes/auth.ts:138-150` (callback), `:101-110` (`/start`).
- **Symptom:** The callback validates state only `if (typeof state === "string" && state.length > 0)`. A crafted callback to `/api/auth/github/callback?code=<attacker_code>` with **no** `state` param skips the CSRF check entirely. The "state is optional on the install-flow callback" rationale doesn't hold: `/github/start` *always* sets a state (`:108`), so a missing state on a sign-in callback is exactly the attack signal, not a legitimate flow.
- **Why it matters:** Classic login-CSRF — an attacker can plant their own GitHub token into the victim's local editor session, so the victim's edits/pushes land on the attacker's account, or the victim operates under attacker-controlled installations. Exploitable in the *current* browser-mode build, not just desktop. Also: `oauthStates` is a process-global `Map` with no cookie/nonce binding the state to the initiating browser (`:44`), so state gives replay-window protection only, not true per-session CSRF binding.
- **Fix shape:**
  - Always require and consume a valid `state` on the sign-in callback. Only waive it when `installation_id` **and** `setup_action` are present (the genuine install-redirect shape), not when state is merely absent.
  - Optionally bind state to the browser: set an httpOnly cookie at `/start` and compare it in the callback.
  - `auth.test.ts` currently *demonstrates* the bypass passing (the install-flow test omits state and succeeds) — add an explicit "missing state on sign-in callback → 400" assertion.
- **Fixed (working tree, uncommitted):** `routes/auth.ts` callback now requires a valid, known `state` before the broker exchange — a missing/unknown state returns 400 and stores no token. The broker-URL-unset debug page (which stores nothing) was moved above the check so it stays state-free. `auth.test.ts`: the old "no state works" test is now a "rejects no state (login-CSRF guard)" test; the broker-error test fetches a real state first. Not done: cookie-binding the state to the initiating browser (replay-window hardening) — left as a P2/P3 follow-up.

### State-changing GitHub/auth routes lack an origin gate

- **Where:** `packages/server/src/index.ts` (`app.use(cors())`, wide open) + `routes/auth.ts`, `routes/github.ts`, `routes/project.ts` `POST /switch`.
- **Symptom:** None of `/api/auth/*`, `/api/github/*`, or `/api/project/switch` check `Origin`/`Referer`. A drive-by browser tab the user visits while TVE is running can `fetch()` `POST /api/project/switch {kind:"github",…}` to mint an installation token and clone an arbitrary accessible repo to disk, or kick off `/api/auth/github/start`.
- **Why it matters:** Same class as the tracked unauthenticated `/exit` route below, but the consequences are heavier — token minting + arbitrary disk writes, not just a DoS. Becomes worse in desktop packaging.
- **Fix shape:** A single `requireEditorOrigin` middleware (must match `http://localhost:3005` in dev / the bundled-editor origin in desktop) applied to every state-changing route. Fold the `/exit` fix into the same middleware — see the P2 `/exit` entry, which proposed exactly this.
- **Fixed (working tree, uncommitted):** new `lib/require-editor-origin.ts` (+ test). It rejects a request whose `Origin` header is present and not in the allowlist (editor URL + server origin); absent-Origin requests pass (navigations, non-browser callers, tests). Mounted in `index.ts` on `/api/project` (covers `/switch` and `/exit`, closing the P2 `/exit` item too) and `/api/github`. The OAuth `start`/`callback` GET navigations stay exempt and rely on the now-mandatory `state` nonce. A drive-by tab's cross-origin `fetch` carries its own (non-editor) Origin → 403.

### Installation schema can't represent org installs

- **Where:** `packages/server/src/services/state-store.ts:327-349` (`upsertInstallation`)
- **Symptom:** `upsertInstallation` does `SELECT id FROM github_account WHERE login = ?` with `accountLogin`. GitHub App installations have an **owner** (user *or* org) which is independent of the **signed-in user**. The Miscreants App is explicitly org-owned, so installations will arrive with `account_login = "Miscreants"` while the signed-in user is something like `jarek-miscreants`. No `github_account` row matches → `upsertInstallation` throws.
- **Why it matters:** Without this fix, listing or installing repos from any org installation fails. Blocks the Phase 2 GitHub picker for the most common production case.
- **Status update (Phase 2):** The shipped Phase 2 picker flow sidesteps `upsertInstallation` entirely — `installationId` is persisted to `.tve-meta.json` per clone, and the SQLite `installations` / `repos` tables stay empty. The picker therefore works end-to-end on the personal-test App (single user installation). The bug is **still present and still P1** — the moment we light up SQLite-backed bookkeeping (e.g. for "recently opened GitHub repos" or for surfacing installations across multiple clones in one UI), org-owned installs will throw.
- **Fix shape:**
  - Add `kind: "user" | "org"` to `github_account` (treat the table as "GitHub principal", not "signed-in user").
  - Or add a sibling `github_org` table; either works. Decoupled-table is cleaner if we ever need org-specific fields.
  - Decouple the signed-in user from installation owners: store the signed-in user's id under a `current_user_id` pref or a 1-row `session` table.
  - **Land in v1 schema, not v2** *iff fixed before any user has a populated `installations` row.* Phase 2 ships with that table empty, so the v1 window is still open.
- **Deferred from the 2026-05-30 security pass.** The other three new P1s (broker token auth, OAuth state, origin gate) plus `resolvePath` were fixed; this one was intentionally left. It's not exploitable (the picker sidesteps the empty `installations` table), and it's a v1-schema design change best done deliberately with the installationId-persistence + broker-extraction items in one lane — not rushed alongside the security fixes. The broker membership check landed without needing this table (it queries GitHub live), so nothing here blocks the fixes that shipped.

### Repo cache `resolvePath` can escape the base

- **Where:** `packages/server/src/services/repo-cache.ts:153-163` (`resolvePath`)
- **Symptom:** Only rejects path separators (`/`, `\\`). `..`, `.`, leading dots, Windows reserved device names (`CON`, `NUL`, `PRN`, `AUX`, `COM1-9`, `LPT1-9`), overlong names, and anything that's not a valid GitHub slug all pass through. After `path.join(base, owner, repo)` the result can land outside `base` or hit a filesystem-reserved name.
- **Why it matters:** The Phase 2 clone route takes `owner`/`repo` from API input *before* path-guard checks. A malicious or mistyped value reaches disk-touching code without a real validation gate.
- **Status update (Phase 2):** Phase 2 shipped the clone route on top of this code without tightening the validator. The picker UI only ever supplies real GitHub `owner`/`repo` values (they come from the GitHub API, not free-text), so the live attack surface is small — but a future "open by URL" or "paste a repo slug" UI would expose it.
- **Fix shape:**
  - GitHub username: `/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/` (no leading/trailing/consecutive hyphens, max 39 chars).
  - GitHub repo name: `/^[a-zA-Z0-9._-]{1,100}$/`, then explicitly reject `.` and `..`.
  - Windows: reject reserved device names case-insensitively (`/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i`), with or without an extension.
  - After `path.resolve(path.join(base, owner, repo))`, assert the result starts with `path.resolve(base) + path.sep`. Throw if not.
  - **Reuse:** the existing `ensurePathInsideBase` helper in the same file already does the path-prefix check — call it from `resolvePath` instead of swallowing it later (see next item).
- **Fixed (working tree, uncommitted):** `repo-cache.ts` `resolvePath` now validates `owner` against the GitHub username grammar, `repo` against `^[a-zA-Z0-9._-]{1,100}$` with explicit `.`/`..` rejection, rejects Windows reserved device names (`con`/`nul`/`com1`…), and asserts the resolved path stays inside `path.resolve(base)` before returning. `repo-cache.test.ts` updated (the old "`..` is accepted" assertion flipped to expect a throw, plus reserved-name coverage). Note: the sibling P2 "symlink-escape check is swallowed" (`ensureDir`'s `.catch(() => {})`) is still open — left as P2.

---

## P2 — Open

### Installation-token caching breaks on malformed/zero expiry

- **Where:** `packages/server/src/services/installation-token-source.ts` (expiry parse, ~`:90-99`) and `packages/server/src/routes/auth.ts` (`expiresAt` derivation, ~`:221-230`).
- **Symptom:** Two related bugs. (1) The source only checks `typeof data.expiresAt === "string"`, then does `new Date(data.expiresAt).getTime()`, which is `NaN` for a malformed value. The cache freshness test `cached.expiresAtMs - margin > now` is then `NaN > now` → always false, so the token is re-minted on **every** push/pull — the cache never hits. (2) In `auth.ts`, `expiresAt: expiresIn ? Date.now() + expiresIn*1000 : null` treats `expiresIn === 0` (a legitimately-expired token) as `null` = never expires.
- **Why it matters:** (1) is a silent performance/quota regression — a broker round-trip per git op. (2) lets a buggy/hostile broker hand TVE a token it treats as perpetual.
- **Fix shape:** `const t = new Date(...).getTime(); expiresAtMs = Number.isFinite(t) ? t : now + 50*60_000;` and `typeof expiresIn === "number" && expiresIn > 0 ? Date.now()+expiresIn*1000 : null`.

### Clone embeds token in URL; scrub is best-effort and reports success on failure

- **Where:** `packages/server/src/services/github-clone.ts` (token-in-URL clone ~`:112-135`, scrub `try/catch` that only `console.warn`s ~`:131-139`).
- **Symptom:** Clone uses `https://x-access-token:<token>@github.com/...` passed as an argv URL to `git`, so the token is visible in the OS process table (`/proc`, `ps`, Windows Process Explorer) for the clone's duration and can land in an active credential helper's cache. The post-clone `remote set-url` scrub is wrapped in a `try/catch` that swallows failures — a scrub failure leaves the token persisted in `.git/config` while the clone is still reported as success.
- **Why it matters:** The push/pull path already uses the safer per-invocation `git -c http.extraheader=...` (never writes config, not in argv URL); clone is the one network op that doesn't. The swallowed scrub failure is a real on-disk token-persistence path.
- **Fix shape:** Use `git -c http.extraheader="Authorization: Basic <b64>"` for clone too, matching `git-transport.ts`. If the defensive scrub still fails, treat the clone as failed and tear down the dir rather than returning success.

### `ref` checkout uses ambient git and swallows stale-checkout on reopen

- **Where:** `packages/server/src/services/github-clone.ts` (`ref` checkout ~`:167-180`, "already exists" `--ff-only` pull ~`:147-162`).
- **Symptom:** (1) `simpleGit(targetPath).checkout(input.ref)` runs on ambient auth and only works if the ref is already present locally — on a fresh clone a non-default private branch isn't fetched, so checkout fails with a confusing pathspec error. Comparing `status.current` (a branch name) to a `ref` that may be a tag/SHA also misfires. (2) On the cached "already exists" path a `--ff-only` pull failure is swallowed and the stale/diverged checkout is handed back as the project, silently editing an out-of-date base.
- **Why it matters:** Non-default-branch opens fail or silently edit the wrong base — a "why are my changes on the wrong commit" footgun once more than the default branch is used.
- **Fix shape:** `git fetch origin <ref>` via the token transport before checkout; don't gate on `status.current`. On the reopen path, surface a structured "behind/diverged" signal to the route so the picker can warn instead of opening silently.

### No refresh-token handling; user token expiry surfaces as a bare 401

- **Where:** `packages/server/src/routes/auth.ts` drops `refreshToken` from the broker response (~`:221-230`); `broker/src/index.ts` returns it (~`:199-200`). Editor: `packages/editor/src/store/auth-store.ts` (~`:32-50`).
- **Symptom:** The broker returns a `refresh_token` (user tokens are ~8h TTL), but the server never stores or uses it. When the token expires mid-session, in-flight repo-picker calls 401 and the user just sees "Not signed in" with no prompt or auto-refresh; `/whoami` only flips to signed-out on next load.
- **Why it matters:** Avoidable mid-session sign-outs once GitHub user-token expiry is enabled on the App. Degraded UX, not a correctness bug.
- **Fix shape:** Persist `refreshToken` alongside the user token and add a refresh path; at minimum surface an explicit "session expired — sign in again" state in `auth-store`.

### `dependency-installer` spawns with `shell: true`; timeout kill leaks the process tree

- **Where:** `packages/server/src/services/dependency-installer.ts` (spawn ~`:48-59`, error/timeout handlers ~`:88-96`).
- **Symptom:** Install runs `corepack.cmd pnpm install` with `shell: true` and `cwd` under `~/.tve/repos/{owner}/{repo}`. On timeout, `child.kill("SIGKILL")` on Windows kills the `cmd.exe` wrapper, not the pnpm/node child tree → a runaway install survives. With `shell: true`, any shell metacharacter that ever reaches `cwd`/args (e.g. a future "open by slug" path feeding the un-tightened `resolvePath`, P1 above) becomes injectable.
- **Why it matters:** Orphaned installs on Windows; latent command-injection surface coupled to the `resolvePath` escape. The file has **no test**.
- **Fix shape:** Drop `shell: true` — resolve the `.cmd` path explicitly and spawn without a shell (also fixes arg-quoting). On timeout, kill the process group (`taskkill /T /F` on win32, or `tree-kill`). Add a test.

### `github-clone.ts` and `dependency-installer.ts` have no tests

- **Where:** `packages/server/src/services/github-clone.ts`, `packages/server/src/services/dependency-installer.ts` — no sibling `*.test.ts`.
- **Symptom:** The entire clone → scrub → validate → install → checkout pipeline (incl. the token-scrub, partial-cleanup, and Windows spawn paths) is uncovered by the 240-test suite.
- **Why it matters:** These are the highest-risk, most platform-sensitive files in Phase 2, and Phase 3 bundling will build on them. Regressions here are silent.
- **Fix shape:** Add `github-clone.test.ts` (mock simple-git + installer: happy path, scrub-failure cleanup, post-clone validation reject leaves dir intact, ref-checkout) and `dependency-installer.test.ts` (pm detection, timeout kill, non-zero exit). Land before Phase 3.

### Symlink-escape check is swallowed

- **Where:** `packages/server/src/services/repo-cache.ts:192-196` (`ensureDir`)
- **Symptom:** `await ensurePathInsideBase(parent, absPath).catch(() => {});` — the defense-in-depth check throws on a real symlink escape, but the `.catch(() => {})` eats it.
- **Why it matters:** This is the only filesystem-touching point in the cache layer that's supposed to refuse a symlink-escape path. As written it does nothing.
- **Fix shape:** Drop the `.catch(() => {})`. `ensurePathInsideBase` already returns silently when paths don't exist yet (lines 102-110), so the only thing left to throw is the actual escape — which is exactly what we want propagated.

### State-store boot failure is non-fatal

- **Where:** `packages/server/src/index.ts:62-75`
- **Symptom:** Comment says "the boot fails loudly if the DB is unreadable rather than at first write." Implementation is `stateStore.open().then(success, err => console.error(...))` — logs and continues. The server still binds the port and accepts requests with a half-disabled persistence layer.
- **Why it matters:** In `desktop` mode the prefs / auth / repo metadata is silently broken — sign-in screens render, repo picker shows nothing, error trail is one line in the server log nobody reads. In `cli` mode the legacy JSON fallback masks the failure but the dual-write becomes single-write.
- **Fix shape:**
  - Refactor boot to `await stateStore.open()` *before* `server.listen()`.
  - In `desktop` mode, throw and let the process exit non-zero so the Electron main process surfaces a dialog.
  - In `cli` mode, log a `console.warn` and continue — recent-projects keeps working via JSON, which is the user-visible feature in CLI mode.

### Unauthenticated `/exit` route

- **Where:** `packages/server/src/routes/project.ts:156-160` + global permissive CORS at `index.ts:48`
- **Symptom:** `POST /api/project/exit` calls `process.exit(0)`. Any webpage the user visits while TVE is running can `fetch("http://localhost:3011/api/project/exit", {method: "POST"})` and kill the editor session. CORS is wide open and the route has no auth.
- **Why it matters:** Drive-by tab can DoS a running TVE session and silently lose the user's unsaved iframe state. Becomes worse in desktop packaging where the editor is the user's main work surface.
- **Fix shape:**
  - Origin / Referer check on the route: must match the configured editor origin (`http://localhost:3005` in dev, the bundled-editor origin in desktop).
  - Apply the same gate to any future "destructive" routes — e.g. a future `POST /api/cache/clear`. Refactoring it into a small middleware (`requireEditorOrigin`) is cheaper than per-route checks.
  - Alternative: an in-process secret in a request header (TVE generates it at boot, the editor reads it from a same-origin endpoint). Heavier, but useful when we want the same gate across many routes without trusting `Origin`.

### Cached repo path can be silently rewritten

- **Where:** `packages/server/src/services/state-store.ts:376-388` (`upsertRepo`)
- **Symptom:** `ON CONFLICT(owner, name) DO UPDATE SET ... fs_path = excluded.fs_path` — every upsert silently repoints `fs_path`. `phase-0-decisions.md` §4 explicitly says one canonical path per `(owner, name)`, with a separate "Move clone…" settings flow. Current behavior contradicts that.
- **Why it matters:** A second clone or open flow that resolves a different cache base (e.g., user toggled `prefs.repos_base_dir` between sessions) will silently relocate an existing repo's bookkeeping while the actual files stay where they were — the next `git status` reads the wrong directory.
- **Fix shape:**
  - Change `ON CONFLICT` to update `installation_id` and `default_branch` only, *not* `fs_path`.
  - Add an explicit `relocateRepo(owner, name, newFsPath)` method that the settings panel's "Move clone…" action calls. Move semantics live there, not in the upsert path.
  - Decision to lock in: should `upsertRepo` *throw* when called with a conflicting `fs_path`, or silently keep the old one? Throw is louder and surfaces the bug; silent-keep matches the spirit of "upsert as idempotent". Probably throw with a structured error that the caller can suppress if they truly mean it.

---

## P3 — Open

### Raw-CSS probe URL fragility (`validateRemoteRepo`)

- **Where:** `packages/server/src/services/project-validator.ts:354` (already shipped — commit `f0327eb`)
- **Symptom:** Builds `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? "HEAD"}/${entry.path}` — branch names with `/` (e.g. `feature/foo`), unicode characters in paths, or any other character needing URL-encoding break the fetch. Repos that *would* validate get false-rejected.
- **Why it matters:** Misclassifies a tiny fraction of valid Astro+Tailwind repos. Picker UI shows them as "incompatible" with no useful error.
- **Fix shape:** Switch to GitHub Contents API for file content (it returns base64-encoded content + handles ref ambiguity natively), or per-segment encode (`segments.map(encodeURIComponent).join("/")`). Contents API is cleaner because the same code already calls it for directory listing.

### `project-validator.test.ts` uses inline tmpdirs instead of `__fixtures__/` tree

- **Where:** `packages/server/src/services/project-validator.test.ts:22-23`
- **Symptom:** Tests `mkdtemp` + `writeFile` per-case. `phase-1-plan.md:493` calls for an on-disk `__fixtures__/` tree (`astro-tw3/`, `astro-tw4/`, `no-astro/`, etc.).
- **Why it matters:** Cosmetic only — tests pass and cover the same matrix. The on-disk tree would let us hand-edit fixtures and inspect them when debugging, and would make a `symlink-escape/` fixture easier to express on POSIX (Windows file systems handle test-time symlinks awkwardly).
- **Fix shape:** Move to `packages/server/src/services/__fixtures__/<name>/` directories. Keep an `astro-tw3/` (config + tailwind.config.mjs), `astro-tw4/` (config + CSS @theme), `astro-no-tw/`, `no-astro/`, and a POSIX-only `symlink-escape/` skipped on Windows.

### Symlink walker `path.relative` check on Windows

- **Where:** `packages/server/src/services/project-validator.ts:161-164` (`walkForEscape`)
- **Symptom:** Uses `path.relative(realRoot, resolved).startsWith("..")`. Works correctly on Windows because `path.relative` returns `..\foo` for outside paths, but it's not obvious from the code. A `path.normalize` pass before `.startsWith` would make the intent explicit.
- **Why it matters:** Pure code clarity. No behavior change.
- **Fix shape:** `const rel = path.normalize(path.relative(realRoot, resolved)); if (rel.startsWith("..") || path.isAbsolute(rel)) ...` — the `isAbsolute` companion check is already there at line 162.

### `iframe-bridge` `postMessage(msg, "*")`

- **Where:** Three sites: `packages/editor/src/lib/iframe-bridge.ts:45`, `packages/server/public/injected.js:441`, `packages/injected/src/bridge.ts:114`.
- **Symptom:** All three send messages with `targetOrigin = "*"`. Any same-process iframe — including a malicious nested frame the user's project might happen to embed — can receive editor↔overlay messages.
- **Why it matters:** Localhost-only tool, so the practical risk is low. Still trivially tightenable: the editor knows the iframe origin is `http://localhost:{astroPort}` (the proxy's upstream), and the injected script knows the editor origin is `http://localhost:3005`. Pinning these prevents a future "open shared template URL in TVE" feature from leaking events to user content.
- **Fix shape:** Editor side — read the proxy's upstream origin from `/api/dev-server/status`, store it on the bridge, pass as `targetOrigin`. Injected side — hardcode the editor origin (it's known at injection time). For both, fall back to `"*"` only when the target origin isn't yet known (e.g. before the dev server has started).

### Token broker still lives inside the workspace

- **Where:** `broker/` directory, registered in `pnpm-workspace.yaml`.
- **Symptom:** Phase 0 §1 / phase-2-plan §11 calls for the broker to live "out of band from main" — its own repo with its own deploy lane. Currently it's a workspace package, so `pnpm install` at the root pulls Worker tooling for everyone, and a stray `git push` of `feat/local-saas` would publish the broker source alongside editor source.
- **Why it matters:** Cosmetic for now (the broker has no secrets in source — those are Worker secrets in the Cloudflare dashboard), but coupling it to the editor monorepo means the editor's commit log and the broker's deploy log are entangled. Also makes it harder to give the broker its own auth-protected CI lane.
- **Fix shape:** `git mv broker /tmp/broker-extract && cd /tmp/broker-extract && git init …` — or, less surgical, copy out, delete from this repo, and start the broker repo fresh. Then update `docs/integration/app-config.md` to point at the new repo. Do this **before** the first production deploy on the Miscreants App, not after.

### `installationId` lives in `.tve-meta.json`, not `state.db.repos`

- **Where:** `packages/server/src/services/repo-cache.ts` (`recordInstallation`, `readInstallation`); compare `state-store.ts:376-388` (`upsertRepo` already has an `installation_id` column waiting).
- **Symptom:** Phase 2 records the installation linkage in a per-clone JSON sidecar (`.tve-meta.json`) instead of the `repos` SQLite row. Two stores of truth means a future "list opened GitHub repos" UI can't just query SQLite — it has to walk the cache directory and read each sidecar.
- **Why it matters:** Functional today (the sidecar is the only consumer), but every new feature that wants installation context per repo will either hit the sidecar (slow, scattered) or the SQLite row (empty). The longer this stays divergent, the more places have to know which is authoritative.
- **Fix shape:** Couple naturally with the org-installs schema fix above — once `installations` can hold both user- and org-owned rows, `cloneFromGithub` should `upsertRepo({ owner, name, installation_id, fs_path })` after writing the sidecar. Keep the sidecar as a cache-local fallback (it's the only thing that survives a `state.db` wipe), but treat SQLite as the source of truth when both are present.

### Server `github_user_token` not in OS keychain

- **Where:** `packages/server/src/routes/auth.ts` persists `githubAccessToken` to `state.db` `prefs.github_user_token` via `attachAuthStateStore`.
- **Symptom:** Phase 2 plan §11 specified `keytar`-backed `OsKeychainTokenStore` for desktop mode; shipped path stores tokens in plain text in `state.db`. `state.db` lives in `~/.tve/`, same trust level as `.gitconfig` for cli mode — fine. For a packaged Electron desktop build sent to a non-technical user, that file ends up in `%APPDATA%` / `~/Library/Application Support` with the same protections as any other app config: no encryption at rest, readable by any other process running as that user.
- **Why it matters:** Token grants the App's permissions on the user's installations (contents:write on the repos they linked). On a shared or compromised user account, an attacker doesn't need the App private key — the user token alone gives them push access. Keychain raises the bar to "process must request access via the OS prompt."
- **Fix shape:** Add a `TokenStore` interface (`get(scope) / set(scope, value) / delete(scope)`). In `cli` mode → SQLite-backed (the current behavior). In `desktop` mode → `keytar` (`service: "tve"`, `account: "${appId}:${userId}"`). The selector lives in `index.ts` next to the `mode` branch. Same pattern works for the App's installation tokens if we ever cache them on disk (currently in-memory only — see `installation-token-source.ts`).

### `LinkSection` `key={href}` causes input remount on external href changes

- **Where:** `packages/editor/src/components/properties/LinkSection.tsx:259`
- **Symptom:** `<input key={href} defaultValue={href} ... onBlur={...} />`. Because `key` changes when `href` changes, React unmounts and remounts the input — losing focus and any in-progress edit if `href` updates from outside (e.g. selection switches to a different element while the user is typing).
- **Why it matters:** Subtle. The user has to be mid-typing *and* the selection needs to change externally for it to bite. But when it does, the typed value vanishes.
- **Fix shape:** Decide on the desired behavior:
  - **(a) Preserve typing:** `key={selectedNodeId}` instead of `href` — input remounts when the selected element changes (good), but stays mounted while typing on the same element (good).
  - **(b) Fully controlled:** `value={href}` + `onChange` writing to local state, `onBlur` flushing to the editor store. Heavier refactor.
  - (a) is the smaller change and matches how other input components in the panel behave.

---

## Resolved (kept for reference)

### Phase 2 GitHub picker route was a 501 stub
- **Where (was):** `packages/server/src/routes/project.ts` `kind: "github"` branch — returned `501 Not Implemented` until Phase 2 landed.
- **Fix:** Now calls `cloneFromGithub` (broker-mints token → URL-embedded clone → scrub → validator → switchProject → auto-install). Verified end-to-end on 2026-05-07: cloned `jarek-miscreants/astro-starter-playground`, edited, pushed.
- **Status:** Lives in unmerged Phase 2 work on `feat/local-saas`.

### `installation-token-source` not wired up
- **Where (was):** `services/installation-token-source.ts` shipped in Phase 1 with full broker-call logic + 60s safety-margin caching, but no caller — `git-transport.ts` still ran the ambient pass-through on every push.
- **Fix:** `index.ts` now wires `createBrokerInstallationTokenSource(...)` into `createTokenGitTransport(...)` whenever an App config is present, and calls `setGitTransport(tokenTransport)`. Debug log line per push confirms which path was taken.
- **Status:** Lives in unmerged Phase 2 work.

### Pull/Push pair was confusing for marketers
- **Where (was):** `GitPanelDialog.tsx` rendered separate "Pull" and "Push" buttons unconditionally. Marketers don't think in git verbs — they think in "publish my changes."
- **Fix:** Single `Publish` button (auto-commits dirty tree with timestamped message, then pushes). `Pull` only renders when `userMode === "dev"` and `behind > 0`.
- **Status:** Lives in unmerged Phase 2 work.

### `AGENTS.md` stale duplicate of `CLAUDE.md`
- **Fix:** Replaced with a one-line redirect pointing at `CLAUDE.md`. Cannot drift if there's nothing to drift from.
- **Status:** Working tree contains the fix; not yet committed.

### `mode-store.loadMode` swallows config errors
- **Where (was):** `packages/editor/src/store/mode-store.ts:22`
- **Fix:** `catch (err) { console.warn("[tve] failed to load TVE config; using built-in defaults", err); set({ loaded: true }); }` — error surfaces in DevTools instead of silent fallback.
- **Status:** Working tree contains the fix; not yet committed.

### `CHANGELOG.md` missing Phase 0/1 entries
- **Fix:** Added `[Unreleased]` entries for the local-SaaS migration scaffolding (Phase 0), CI smoke job, and Phase 1 steps 5–8 with their test counts.
- **Status:** Working tree contains the fix; not yet committed.

### `recent-projects.ts` JSON path mismatch with `tveHome()`
- **Symptom (was):** Plan assumed `~/.tve/recent-projects.json`; existing code uses `~/.tve-recent.json`. SQLite import would have looked at the wrong path.
- **Fix:** `state-store.ts` defaults `legacyJsonPaths` to *both* — `os.homedir()/.tve-recent.json` and `tveHome()/recent-projects.json`. First non-empty source wins. No history loss.
- **Status:** Lives in unmerged Phase 1 step 7 work.

### `tsconfig.tsbuildinfo` not gitignored (review claim)
- **Disposition:** False positive. `.gitignore:5` already has `*.tsbuildinfo`. Confirmed via `git ls-files --error-unmatch packages/editor/tsconfig.tsbuildinfo` returning "did not match any file(s)".

---

## Process notes

- The first review (the bigger list) was done against committed history rather than the working tree, which made it think Phase 0 was missing when it was actually staged-but-not-committed. When triaging future review reports, **always check `git status` first** — a finding that's already in-tree just needs landing, not redoing.
- Schema migrations are append-only. Anything that touches `state-store-migrations.ts` v1 has to be decided *before* the first real `state.db` lands on a user machine — once it has, changes go in v2 with a backfill. Phase 2 ships with `installations` and `repos` tables empty, so the v1-window decision deadline for the org-installs / repo-installation-id work is **before the first non-test user runs the desktop build**, not before the next tsx-watch reload.
- Phase 2 added three follow-ups that share a single fix lane (org-installs schema, installationId persistence, broker extraction). When picking one up, scope the work so the other two can land in the same PR — they touch overlapping decisions about where authoritative repo metadata lives.
- The **broker token-minting auth** P1 and the **broker extraction** P3 touch the same files (`broker/src/index.ts`) and the same deadline ("before the production Miscreants App deploy") — do them together. The org-installs schema fix is also adjacent because the proper minting check (`GET /user/installations` membership) wants the installations table populated. So the broker-auth P1, org-installs schema P1, installationId-persistence, and broker extraction realistically form one pre-production-deploy lane.
- 2026-05-30 build review (Phases 0–2, working tree still uncommitted): server 240/240 tests pass, editor build clean. Added the three P1 auth items + five P2 items above. The two headline P1s (broker mints tokens without caller auth; OAuth `state` bypassable) were verified directly in source, not just flagged by a reviewer. They are the only Phase 2 issues exploitable in the *current browser-mode* build, so they rank above the desktop-only items.
