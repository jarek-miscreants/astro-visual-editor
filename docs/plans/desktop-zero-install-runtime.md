# Desktop Zero-Install Runtime: Provisioning Node + pnpm for the User's Project

Status: design — approved direction, not implemented (Phases 3–4 are unbuilt).
Created: 2026-06-09.

Companion to `migration-plan.md` Phases 3–4 and `phase-0-decisions.md`
§2a (Electron-only delivery, server runs on Electron's Node). This doc
answers the make-or-break question for a non-technical-user POC:

> The user installs nothing — no Node, no pnpm, no git. They open the
> app, pick a repo, and it just installs and runs. How?

## The promise (and what it actually means)

"Zero install" means **the app brings the entire toolchain**. The user
needs no system Node, package manager, or git CLI. It does **not** mean
zero network or zero wait — the first open of a repo still downloads the
project's dependencies from the npm registry (a few minutes, needs a
connection). The distinction to communicate in the UI: *tooling* is
bundled; *project dependencies* are fetched once per repo.

## Scope-shrinker: the production build is remote, not local

Per the publishing model (Webflow-style draft → live via the host
platform's branch previews — see `publish-flow-transition.md` and
`git-integration.md`), the production `astro build` runs on **Cloudflare
Pages on push**, not on the user's machine. So the local app never has
to run a full production build for a non-technical user.

Local runtime obligations reduce to exactly three Node-shaped tasks:

1. `pnpm install` — once per repo, after clone / when the lockfile changes.
2. `astro dev` — the live editing preview the iframe proxies.
3. `git push` — already solved (token-injecting transport, Phase 2).

No local `astro build`. This materially shrinks the POC's runtime surface.

## The recipe — three pieces

### 1. Node → Electron's own runtime

Electron bundles a complete Node. Run any Node script by spawning
`process.execPath` (the Electron binary) with `ELECTRON_RUN_AS_NODE=1`
in the child env — Electron then behaves as plain Node.

- **Already 90% there:** `services/astro-cli.ts` already returns
  `{ cmd: process.execPath, args: [localAstro, ...] }` when the project
  has a local `node_modules/astro/bin/astro.mjs`. Under Electron that
  `execPath` is the Electron binary, so the **only change needed** is to
  set `ELECTRON_RUN_AS_NODE=1` on the spawn env in desktop mode.
- **Drop the `npx astro` fallback for desktop.** The fallback (`npx`
  when no local astro) can't work — Electron's Node ships no `npx`. After
  a successful install there is always a local astro, so the primary path
  covers the real case; the fallback should surface a clear error in
  desktop mode instead of spawning a missing `npx`.

### 2. Package manager → bundle pnpm's standalone `.cjs`

This is the real gap. **Electron's bundled Node does not include `npm`
or `npx`**, so the current `services/dependency-installer.ts` (which
shells out via Corepack) will not work for a no-Node user.

Fix: **ship pnpm's standalone single-file bundle** (`pnpm.cjs`, as
published in the `pnpm` package's `bin/`) inside the app's
`resources/`. Install becomes:

```
<electron, ELECTRON_RUN_AS_NODE=1> <resources>/pnpm/pnpm.cjs install
  (cwd = cloned repo dir)
```

Deterministic, and it does not network-provision the package manager
itself (only the project deps download, which is unavoidable). Matches
the existing pnpm-first design.

**POC simplification — pnpm-only.** Do not bundle npm/yarn for the POC.
Run pnpm for every repo regardless of which lockfile is present. The
initial targets are our own Astro starters / Miscreants templates, so
lockfile fidelity across package managers is not yet needed; this erases
a large pile of multi-PM complexity. Revisit if/when arbitrary
third-party repos with npm/yarn lockfiles become a goal.

### 3. (Optional) a `node` PATH shim

Some dependency postinstall scripts shell out to a bare `node` on PATH.
A tiny shim directory prepended to the child's PATH — containing a
`node` / `node.exe` that re-execs Electron-as-node — covers them. Likely
**skippable for the POC**; add only if an install surfaces a
"`node: command not found`" from a postinstall.

## Code touch-points (when implemented)

| Concern | File today | Change for desktop |
|---|---|---|
| Spawn astro dev | `services/astro-dev-server.ts` + `services/astro-cli.ts` | Set `ELECTRON_RUN_AS_NODE=1` on the spawn env; demote the `npx` fallback to a clear desktop error |
| Install deps | `services/dependency-installer.ts` | Replace Corepack invocation with bundled `pnpm.cjs` run via Electron-as-node; pnpm-only for POC |
| Resource path | (new) | A `resourceDir`/`TVE_RESOURCE_DIR`-aware resolver for `pnpm.cjs` (and the editor `dist/`), packaged vs dev |

These are server-side changes gated on desktop mode; CLI mode keeps
using the system Node + Corepack exactly as today.

## Unavoidable limitations (state them honestly)

- **First-open is slow and needs internet.** Bundling Node + pnpm
  removes the tooling install, not the dependency download. Surface a
  progress UI; the clone+install path already streams status.
- **Node-version drift.** Electron 33 ships Node ~20.x. Astro 6 is happy
  there, but a project pinning bleeding-edge Node features could
  complain. Pin the Electron version deliberately; low risk for
  Astro+Tailwind sites.
- **Native compilation in the *user's* project.** A project dep needing
  `node-gyp` + a C toolchain the user lacks will fail to install. Rare
  for marketing sites (`sharp` etc. ship prebuilds). Acceptable as a
  documented POC limitation.

## The spike to run before committing to the shell

Half a day, no Electron UI required:

1. Take a packaged/portable Electron (or `electron` from node_modules).
2. `ELECTRON_RUN_AS_NODE=1 <electron> <pnpm.cjs> install` against a freshly
   cloned Astro+Tailwind starter.
3. `ELECTRON_RUN_AS_NODE=1 <electron> node_modules/astro/bin/astro.mjs dev`
   and confirm the dev server boots and the existing proxy + `<base>` tag
   + HMR still work through TVE's preview route.

Green here means the "no install, just open and edit" POC has no
remaining unknowns and is a ~2-week shell build. Red (native rebuild or
PM provisioning fights back) means scope the runtime properly before the
shell.

## Relation to other plans

- `phase-0-decisions.md` §2a — Electron-only, server on Electron's Node.
- `phase-3-plan.md` — must additionally package `pnpm.cjs` into resources.
- `phase-4-plan.md` — `spawnServer` (`utilityProcess.fork`) and the
  desktop env must propagate `ELECTRON_RUN_AS_NODE` to grandchild spawns
  (astro dev, pnpm), and the resource layout must include `pnpm.cjs`.
- `publish-flow-transition.md` — the remote-build assumption that keeps
  `astro build` off the user's machine.
