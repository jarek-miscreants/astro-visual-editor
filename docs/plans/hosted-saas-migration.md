# TVE Hosted GitHub SaaS Migration Plan

Status: draft for review — do not implement.

## Summary

Move TVE from a single localhost project editor into a multi-tenant webapp
with GitHub login, repo installation, isolated ephemeral editing sessions, and
GitHub-backed persistence.

Locked choices:

- Auth/repo access: GitHub App with user login and repository installation.
- Runtime: managed container workers.
- Database: Neon Postgres.
- Workspace model: ephemeral per-session containers.
- Collaboration v1: multi-tenant, not real-time co-editing.
- Publishing: support both draft branch + PR and direct branch push, with PR
  flow as the default.

## Key Changes

### Split the app into a control plane and workspace workers

- Control plane owns auth, GitHub App callbacks, repo/session records, worker
  orchestration, billing-ready tenant boundaries, and API routing.
- Each worker owns one isolated repo checkout, file watcher, Astro dev server,
  preview proxy target, mutation engine, and Git operations.
- Workers do not hold direct Postgres connections — only the control plane
  talks to Neon. Workers communicate with control plane over HTTP/RPC. This
  prevents a session spike from exhausting the pooler.
- Replace global `app.locals.projectPath`, the global file watcher, and the
  global Astro process with session-scoped workspace context.

### Add GitHub SaaS flow

- User logs in with GitHub (user-to-server token via the GitHub App, not a
  separate OAuth App).
- User installs/configures the GitHub App for selected repos.
- Backend stores user, installation, repo, and session metadata in Neon.
- Backend generates short-lived installation tokens on demand from the App's
  signed JWT; do not persist installation tokens.
- Requested App permissions, minimum viable: `contents:write`,
  `pull_requests:write`, `metadata:read`. Anything broader is out of scope
  for v1 and a security review item.
- Clone via HTTPS using the installation token, create or checkout the
  requested editing branch, run dependency install / preflight, then start
  Astro preview.
- Webhook handlers in scope (not just the install handshake):
  - `installation.deleted` → terminate all workers and revoke active
    sessions for that installation.
  - `installation_repositories.removed` → terminate workers tied to the
    removed repos.
  - `push` to an actively-edited branch → flag the affected session as
    stale; surface a "remote moved" banner; require rebase/refresh before
    next push.

### Add hosted workspace lifecycle

- `POST /api/workspaces` creates an ephemeral session for `{repo, branch,
  mode}`.
- Worker clones into an isolated temp volume and exposes scoped API/WS/preview
  endpoints behind the gateway.
- Session lifecycle states: `pending → cloning → installing → preflight →
  starting → ready → idle → terminating → terminated` with a parallel `failed`
  terminal. Persisted to `workspace_events` for audit and debug.
- Idle sessions shut down after a fixed timeout (e.g. 15 min).
- Source of truth remains GitHub; local worker state is disposable.

#### Cold start strategy (called out explicitly)

`git clone` + `pnpm install` + `astro dev` is 30–120s for a real project. UX
plan must answer all three:

1. **First-paint state.** Show a streamed log of clone → install → boot, not
   a blank spinner. The session-state machine above drives this.
2. **`node_modules` reuse.** Cache install artifacts per `(repo, lockfile
   hash)` on a worker-pool volume so repeat sessions skip the install step.
   Lockfile hash, not branch, is the cache key.
3. **Warm pool.** A small pool of pre-booted workers (no repo attached) cuts
   container-start latency. Sized from observed concurrency, not a guess.
   Cost-tunable.

#### Dirty-state semantics (replaces "warning + recovery metadata")

The editor writes to disk on every mutation, so "dirty" means "uncommitted
local file changes the user has not yet pushed." Two concrete behaviors:

- **Idle teardown with dirty changes:** before terminating, the worker
  auto-commits to a scratch branch `tve/autosave/{sessionId}` and pushes it
  via the installation token. The session record stores the scratch branch
  ref. "Recover session" reopens against that branch and offers to rebase
  onto the original target.
- **Hard teardown (crash, eviction):** scratch branch may not exist. The
  session record is marked `lost-dirty`; UI surfaces this on next login with
  the original branch's last-known-good commit.

#### Concurrent sessions on the same branch

Real-time co-edit is out for v1, but two tabs / two users editing
`feature/x` is in scope. Behavior:

- Each session gets its own clone and worker — no attachment.
- On push, control plane checks the remote tip. If it advanced, push is
  rejected and the user sees a diff against the remote with a
  rebase-or-discard choice. No silent auto-rebase.

### Adapt editor UI

- Replace local path picker with GitHub repo picker (driven by installations
  the user can see).
- Add session startup states: cloning, installing, preflight, dev server
  starting, ready, failed — surfaced as the streamed log above.
- Keep existing visual editor, properties panel, design system, content
  editor, tree editing, preview, and Git panel behavior.
- Git panel gains publish-mode selector: "Open/update PR" (default) or "Push
  directly". Direct push is gated on the user having write access to the
  target branch via the installation.

### Preview routing (decision required before build)

Today the iframe loads `/preview/` and an injected `<base href="http://
localhost:{astroPort}/">` makes Vite client, CSS modules, and HMR WebSocket
resolve natively to the Astro dev server. In SaaS that base URL must be a
public, authenticated, per-session origin, and Vite's HMR WebSocket upgrade
must traverse the gateway.

Two options:

- **Subdomain-per-session** — `https://{sessionId}.preview.tve.app`. Needs
  wildcard TLS and DNS, but Vite/HMR works unmodified. Recommended.
- **Path-prefixed proxy** — `https://app.tve.app/preview/{sessionId}/...`.
  No DNS work but requires rewriting Vite's HMR WS URL and CSS asset paths
  on the fly. Fragile against Astro/Vite upgrades.

This decision shapes the gateway, cert plumbing, and worker config. **Pick
before implementation starts.**

### Container runtime (decision required before build)

"Isolated containers" must be specified — Docker namespaces alone are not a
tenant boundary when running untrusted `pnpm install` and `astro dev`.
Candidates:

- **Fly Machines / Modal / E2B / Northflank / Cloudflare Containers** — pick
  one. Each has different isolation (gVisor, Firecracker, Kata) and
  different cold-start, network, and cost profiles.
- **Egress: deny-by-default with allowlist.** npm registry + GitHub +
  whatever the project's `package.json` legitimately needs. Without this,
  supply-chain attacks become a cross-tenant problem.
- **Quotas:** CPU, RAM, disk, wallclock. Worker dies on quota breach;
  control plane logs and surfaces to the user.

### Store core SaaS data in Neon

Tables:

- `users`
- `github_accounts`
- `installations`
- `repositories`
- `workspace_sessions`
- `workspace_events`
- `branch_configs` — per-`(repo, branch)` editor preferences (default
  publish mode, auto-commit on idle yes/no, allowed file globs). Lives at
  branch granularity because policy differs between `main` and feature
  branches.
- `commits` / `publish_events`

Token handling:

- Encrypt any refresh/user tokens that must be stored.
- Prefer short-lived token generation (installation tokens) over storage.
- App private key in a managed secret store (KMS / cloud secret manager /
  Vault). `.env` is not acceptable for production.
- Use Neon **pooled** connections for app traffic and **direct** connection
  for migrations.

### Security baseline for public SaaS

- Treat repo code as untrusted.
- Run workers in isolated containers (per the runtime decision above) with
  no shared filesystem, no ambient secrets, restricted network, CPU / RAM /
  disk / time quotas, and automatic teardown.
- Never expose raw worker ports publicly; route through an authenticated
  gateway with workspace ownership checks.
- Scope WebSocket broadcasts by workspace session, not globally.
- Audit log all installation token mints, pushes, and PR creations.

## Cost model (rough)

Active editing hour ≈ container minutes + storage + egress + Neon
queries. Worth a back-of-envelope estimate before scoping a free tier:

- Container: depends on runtime choice; expect $0.05–$0.20 per active hour.
- Egress: dominated by clone + npm install on cold start; cached
  `node_modules` swings this 10×.
- Warm pool: fixed cost regardless of usage — sized to observed concurrency.

If a free tier is in scope, idle teardown timeout, warm-pool size, and the
`node_modules` cache are the three knobs that decide unit economics.

## Prerequisite Stabilization

Before migration, fix the review findings that would become harder in SaaS:

- Injected overlay typecheck and protocol mismatch.
- Centralized path guard coverage for all write/read routes.
- Structural undo/redo placeholders or disable unsupported undo actions.
- Tailwind v3 token color sync.
- WebSocket handler accumulation.
- Port/docs mismatch.

## Test Plan

- **Unit:** GitHub App auth helpers, token refresh/generation, repo access
  checks, workspace session state transitions.
- **Integration:** clone, install, parse AST, mutate source, commit, push,
  PR creation against a disposable test repo.
- **Security:** cross-tenant access denial, invalid workspace IDs, path
  traversal, revoked installation, deleted repo, expired token, worker
  teardown, egress allowlist enforcement.
- **E2E:** login → install repo → open editor → start preview → edit
  class/text/content → commit → push direct → open PR → reopen a new
  session and confirm it picks up the latest GitHub state, not stale local
  cache.
- **Load:** concurrent workspace startup, idle cleanup, WebSocket routing,
  Neon connection usage under spike.

## Assumptions

- v1 does not include live multi-user co-editing in the same page.
- GitHub is the only source provider for v1.
- GitHub remains the durable source of edited project files; workers are
  cache/session state only.

## Open decisions (block implementation)

1. **Preview routing** — subdomain-per-session vs path-prefixed proxy.
2. **Container runtime + isolation** — pick one provider; pick gVisor /
   Firecracker / Kata-class isolation, not bare Docker.

Everything else can be iterated.

## References

- GitHub Apps vs OAuth Apps.
- GitHub App user-to-server tokens.
- Installation access tokens.
- Neon connection pooling.
