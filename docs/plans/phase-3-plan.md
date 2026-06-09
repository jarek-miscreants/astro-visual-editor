# Phase 3 — Server Bundling: Implementation Plan

Status: draft for review — do not implement until approved.

> **⚠️ SUPERSEDED IN PART (2026-06-09) — the Node SEA single-binary plan is dropped.**
> Electron is the **only** delivery path (no hosted web app, no
> standalone server CLI — see `phase-0-decisions.md` §2a). With Electron
> as the sole host, there's no reason to compile the server into a
> standalone SEA binary that embeds its own Node — Electron already ships
> one. **Phase 3 is reduced to:** (1) esbuild-bundle `packages/server` to
> a single JS file, (2) ship the `/api/health` endpoint + boot ordering
> (Step 15c — unchanged), and (3) the server static-serves
> `editor/dist/` (Step 16 — unchanged). The SEA blob / `postject` /
> per-OS Node binary / embedded-WASM / native-sidecar work below
> (old Steps 15a, 15b, 15d) is **no longer planned** — kept below for
> reference and rationale only. Phase 4 runs the bundled server via
> `utilityProcess.fork()` on Electron's Node; native modules are rebuilt
> for Electron's ABI with `electron-rebuild`. Phase 3 must **also package
> pnpm's standalone `pnpm.cjs` into app resources** so the user's project
> installs with no system Node/pnpm — see
> [`desktop-zero-install-runtime.md`](desktop-zero-install-runtime.md).

Companion to `migration-plan.md` Phase 3 (steps 15–16). Phases 0–2 are
complete and **merged to `main`** (2026-06-09): the server boots in `cli`
or auth-enabled mode against a real GitHub App, the editor is a Vite SPA at
`packages/editor/dist/`, and `pnpm dev` against `test-project/` still
passes.

~~This phase produces **a single shippable server artifact per platform**
that does not require a system-wide Node install~~ (superseded — see
banner above). The surviving Phase 3 goal: an esbuild-bundled server that
statically serves the production editor bundle on the same origin and is
forkable by the Phase 4 Electron shell on Electron's own Node. **No
Electron code lands here.**

## Phase 3 scope (one-line summary per step)

| # | Step | New files | Touched files |
|---|------|-----------|---------------|
| 15a | esbuild-bundle the server JS to a single file (**SEA blob/postject part DROPPED**) | `packages/server/build/bundle.mjs` | `packages/server/package.json` (scripts), `packages/server/tsconfig.json` |
| ~~15b~~ | ~~Vendor native deps + WASM as sidecars~~ — **DROPPED** (Electron's Node + `electron-rebuild` handles natives; WASM resolves from `node_modules`) | — | — |
| 15c | Health endpoint + boot ordering | `packages/server/src/routes/health.ts` | `packages/server/src/index.ts` |
| ~~15d~~ | ~~Cross-platform Node-binary build pipeline~~ — **DROPPED** (no per-OS server binary; the Electron build in Phase 5 produces the per-OS artifacts) | — | — |
| 16 | Statically serve editor `dist/` | — | `packages/server/src/index.ts`, `packages/editor/package.json` (build script reachable from server) |

## Guiding constraints

- **CLI mode unchanged.** The `tve <path>` source workflow still uses
  `tsx`, not the binary. Binary is an *additional* artifact, not a
  replacement, until Phase 6 cutover.
- **No new runtime features.** Phase 3 is purely a packaging change.
  Functional surface area, routes, and behavior are identical between
  `pnpm dev` and the binary. If a feature has to be added to make
  bundling work, it gets shipped behind a Phase 1/2 PR first, not
  smuggled into Phase 3.
- **Native modules are a known sharp edge.** SEA cannot statically
  link NAPI addons. The plan ships them as `.node` sidecars and
  documents that explicitly. No clever tricks.
- **Same-origin invariant holds.** `phase-0-decisions.md` §2 locks in
  "server static-serves editor at `/`." Phase 3 implements that. No
  CORS surface added; no separate origin for the editor.
- **Build determinism beats build cleverness.** Reproducible per-OS
  artifacts are worth more than minimal bundle size. Use the
  recommended path (esbuild → SEA blob) even if a smaller alternative
  exists.

## Prerequisites (must complete before starting Phase 3)

1. **Phase 1 + Phase 2 PRs landed on `main`** behind `TVE_MODE`. The
   binary cannot diverge from source, so source must be final first.
   ✅ **Met 2026-06-09** — `feat/local-saas` fast-forward merged to `main`.
2. **Node version pinned.** Add `"engines": {"node": ">=22.7.0"}` to
   the root `package.json` and a `.nvmrc` containing `22`. SEA APIs
   stabilized in 22; Phase 3 builds against exactly that line.
3. **Editor build verified.** `pnpm --filter @tve/editor build` produces
   a working `dist/` that loads against the dev server. Spot-check
   before starting; if there's a residual Vite or env quirk, fix it as
   a Phase 2 follow-up, not inside Phase 3.
4. **Native dep prebuilds confirmed for Node 22 on win/mac/linux.**
   `better-sqlite3@12.9.0` already ships these (we hit this in Phase 1
   with `12.x`). Confirm `keytar@7.x` does too — it'll be installed but
   unused in Phase 3, ready for Phase 4 to consume.

If any prerequisite is missing, do NOT start Phase 3 — bundling against
moving source code or a broken editor build creates rebase pain.

---

## Step 15 — `packages/server` → single binary

**Goal.** Produce `tve-server-{platform}-{arch}` (e.g. `tve-server-win-x64.exe`,
`tve-server-darwin-arm64`, `tve-server-linux-x64`) that boots without
a system Node and serves identical functionality to `pnpm dev`.

### 15a — Bundle the server JavaScript

**Files**

- New: `packages/server/build/bundle.mjs` — esbuild driver script.
- New: `packages/server/build/sea-config.json` — Node SEA config.
- Edited: `packages/server/package.json` — adds `build:bundle`,
  `build:binary` scripts.
- Edited: `packages/server/tsconfig.json` — confirm `outDir` doesn't
  collide with build/ output.

**Approach.** Two-step compile:

1. **esbuild** — bundle `src/index.ts` (and all transitive workspace
   deps from `@tve/shared`) into a single ESM-as-CJS file at
   `packages/server/build/out/index.cjs`. Externalize anything that
   loads native bindings or WASM at runtime so they resolve from the
   sidecar `node_modules/` (see 15b).
2. **Node SEA** — feed `index.cjs` into `node --experimental-sea-config
   sea-config.json` to produce a SEA blob, then `postject` it into a
   copy of the Node 22 binary for the host platform. Output written to
   `packages/server/build/dist/tve-server[.exe]`.

**bundle.mjs sketch**

```js
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(root, "build/out/index.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",                 // SEA requires CJS today
  sourcemap: "external",
  minify: false,                 // keep stack traces readable
  legalComments: "none",
  external: [
    "better-sqlite3",            // .node binding loaded at runtime
    "keytar",                    // ditto, Phase 4 consumer
    "@astrojs/compiler",         // ships WASM; loaded via dynamic import
    "fsevents",                  // chokidar's optional macOS native
  ],
  define: {
    "process.env.TVE_BUILD": JSON.stringify("binary"),
  },
});
```

**sea-config.json**

```json
{
  "main": "build/out/index.cjs",
  "output": "build/out/sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true,
  "assets": {
    "astro-compiler.wasm": "build/assets/astro-compiler.wasm"
  }
}
```

The `assets.astro-compiler.wasm` field embeds the compiler's WASM
blob into the SEA. At runtime the server reads it via
`sea.getAsset("astro-compiler.wasm")` (added in Node 22.5) and feeds
it to `@astrojs/compiler`'s `initialize({ wasmURL })` API instead of
the default file resolution. **Why embed.** WASM is read-only,
~3 MB, and decoupling it from `node_modules/` simplifies the runtime
filesystem layout (only the truly-native `.node` files have to live
on disk).

**Asset bridge.** Add a thin module
`packages/server/src/lib/sea-assets.ts` that wraps
`process[Symbol.for("nodejs.sea.getAsset")]`-style access behind a
plain function. In `tsx` dev mode it reads the WASM from
`node_modules/@astrojs/compiler/dist/...` instead. One file, one
branch on `process.env.TVE_BUILD === "binary"`.

**Tests**

`packages/server/build/__tests__/bundle.test.ts`:

- Bundle completes under 5 s on a warm cache. (Smoke test, not a
  performance gate.)
- Output `index.cjs` is parseable by Node and has expected `require`
  calls for the externalized natives. Regex-grep the bundle for
  `require("better-sqlite3")` so a future esbuild config change that
  accidentally inlines a native dep fails loudly.
- The four `external`s land in the bundle as runtime requires, not
  inlined.

### 15b — Vendor native deps + WASM as sidecars

**Files**

- New: `packages/server/build/copy-natives.mjs` — copies the host's
  `node_modules/{better-sqlite3,keytar,fsevents}` (just the runtime
  `.node` + `package.json` minimum) into `build/dist/native/`.
- (No source changes; the externalized requires resolve into this
  vendored directory at runtime via a tiny loader shim.)

**Layout produced**

```
packages/server/build/dist/
├── tve-server[.exe]            # SEA-injected Node binary
├── public/                     # injected.js for the iframe overlay
└── native/
    ├── better-sqlite3/
    │   ├── package.json
    │   └── build/Release/better_sqlite3.node
    ├── keytar/
    │   ├── package.json
    │   └── build/Release/keytar.node
    └── fsevents/               # macOS only; absent on win/linux
```

**Why a sidecar `native/` instead of unpacking under `node_modules/`.**
Two reasons:

1. **Search-path control.** A bundled CJS that's been postject'd into
   the Node binary has no obvious "module root" — Node's resolution
   would walk up from `process.execPath`, which on the user's machine
   sits inside the Electron `Resources/` directory. Putting the
   vendored deps in a sibling `native/` lets us point at them
   explicitly via a small loader shim.
2. **Auditability.** Anyone sanity-checking a built artifact can
   `ls native/` and see exactly which `.node` files ship. A
   user-readable `node_modules/` would invite the question "is this a
   regular Node install?" — which it isn't.

**Loader shim.** A 30-line `packages/server/src/lib/native-loader.ts`:

```ts
const nativeRoot = path.join(path.dirname(process.execPath), "native");

function loadNative(packageName: string): unknown {
  const pkgDir = path.join(nativeRoot, packageName);
  // Node will read package.json `main` and resolve to the .node file.
  return require(pkgDir);
}

export const sqlite3 = loadNative("better-sqlite3");
export const keytar  = loadNative("keytar");
```

`services/state-store.ts` and (Phase 4) `services/keychain.ts` import
the native through this shim instead of via direct `import sqlite3
from "better-sqlite3"`. In `tsx` dev mode, `nativeRoot` is undefined
and the shim falls back to a plain `require(packageName)`. One conditional,
one fallback — same pattern as 15a.

**copy-natives.mjs behavior.** Node version + platform + arch must
match between the build host and the target. We don't currently support
cross-compilation (you can't take a Linux `better_sqlite3.node` and
ship it on Windows). The script:

1. Read `packages/server/node_modules/{name}/package.json` to confirm
   the prebuilt is present.
2. `cp` the package's `package.json` (rewritten with `main` pointing
   at the `.node` file directly, so the shim's `require(pkgDir)` works
   without resolving `.js` files we don't ship).
3. `cp` the `.node` file from `build/Release/`.
4. Skip macOS-only deps when `process.platform !== "darwin"`.

**Tests**

`packages/server/build/__tests__/copy-natives.test.ts`:

- After `node build/copy-natives.mjs`, `build/dist/native/better-sqlite3/`
  exists and contains a parseable `package.json` whose `main` points
  at the actual `.node` file.
- `keytar` likewise.
- `fsevents` directory present on darwin, absent on win/linux.
- Loader shim against the produced layout: spawn `node -e
  "require('./build/dist/native/better-sqlite3')"` from within
  `build/dist/`; expect exit 0.

### 15c — Health endpoint + boot ordering

**Files**

- New: `packages/server/src/routes/health.ts`
- Edited: `packages/server/src/index.ts` — mount it; await
  state-store open *before* `server.listen`.

**Why now.** Phase 4's Electron shell waits for `GET /api/health` to
return `200` before opening `BrowserWindow`. Adding the route in
Phase 3 gives the binary a heartbeat the Electron parent can rely on,
without coupling Phase 4 to a server change.

**Contract**

```
GET /api/health → 200 { "ok": true,
                        "mode": "cli" | "desktop",
                        "appConfigured": boolean,
                        "stateStore": "open" | "opening" | "failed",
                        "version": "0.x.y" }
```

- `200` only when the state store is open and the editor static dir
  is mounted. Until then → `503` with `{ "ok": false, "phase":
  "starting" }`. Electron polls until `200`.
- Tied to a single `app.locals.bootPhase` flag flipped from
  `"starting"` → `"ready"` at the end of the boot promise chain.

**Boot ordering fix.** Today, `stateStore.open()` is called as
`.then(success, err => console.error)` — boot continues whether or
not the DB opens (this is a P2 follow-up: "State-store boot failure
is non-fatal"). Phase 3 lands the fix as part of the health work
because:

1. The health endpoint needs a deterministic "ready" signal. Today's
   "log-and-continue" makes that signal lie.
2. Electron will hit `localhost:{port}/api/health` and refuse to
   open the window until 200. Phase 3 should ship a binary that
   actually goes ready.

```ts
async function boot() {
  await stateStore.open();
  syncAppContextIfConfigured(stateStore);
  attachStateStore(stateStore, TVE_MODE);
  attachAuthStateStore(stateStore);
  app.locals.stateStore = stateStore;
  if (githubAppConfig) wireTokenTransport(stateStore, githubAppConfig);
  if (resolvedInitialPath) await attachWatcher(resolvedInitialPath);
  app.locals.bootPhase = "ready";
}
boot().then(
  () => server.listen(PORT, () => console.log(`Listening on :${PORT}`)),
  (err) => {
    console.error("[TVE] boot failed:", err);
    process.exit(TVE_MODE === "desktop" ? 1 : 0);
  }
);
```

In `desktop` mode, exit 1 so the Electron parent can show a dialog.
In `cli` mode, exit 0 — the legacy `recent-projects.json` fallback
keeps the user-visible feature working without SQLite, but the user
should be told via stderr.

**Tests**

`packages/server/src/routes/health.test.ts`:

- `503` with `phase: "starting"` immediately after `server.listen`
  but before `bootPhase = "ready"`.
- `200` with `mode + appConfigured + version` after boot completes.
- `appConfigured: false` when no GitHub App is configured.
- `mode === "cli"` when `TVE_MODE === "cli"` (default).

### 15d — Cross-platform build pipeline

**Files**

- New: `.github/workflows/server-binary.yml` — matrix build on push
  to `feat/local-saas` (and tags `v*`).
- New: `packages/server/build/README.md` — manual build steps for
  contributors who don't want CI.
- Edited: `packages/server/package.json` — `build:binary` script.

**Matrix**

| Runner | Output |
|---|---|
| `windows-latest` (x64) | `tve-server-win-x64.exe` |
| `macos-13` (Intel x64) | `tve-server-darwin-x64` |
| `macos-14` (Apple Silicon arm64) | `tve-server-darwin-arm64` |
| `ubuntu-latest` (x64) | `tve-server-linux-x64` |

**Universal mac binary.** `lipo -create darwin-x64 darwin-arm64 -output
tve-server-darwin-universal` runs in a follow-up job. We ship
universal for distribution, but the matrix produces both halves first
so that if one arch fails the other still uploads as an artifact for
debugging.

**Linux ARM and Windows ARM** are out of scope for v0.1. Documented
in `build/README.md` as a future addition.

**`build:binary` script** in `packages/server/package.json`:

```json
{
  "scripts": {
    "build:bundle": "node build/bundle.mjs",
    "build:natives": "node build/copy-natives.mjs",
    "build:sea":     "node build/make-sea.mjs",
    "build:binary":  "pnpm build:bundle && pnpm build:natives && pnpm build:sea"
  }
}
```

`make-sea.mjs` orchestrates the SEA-blob + postject step (split out
because it has the most platform-specific bits — `signtool` removal
on Windows, `codesign --remove-signature` on macOS before postject,
both because postject can't modify a signed binary). Comments in the
script document each platform's quirks.

**CI gate.** The matrix workflow builds, then runs a smoke test:

1. Spawn the binary with `TVE_PROJECT_PATH=packages/test-project`.
2. Wait for `GET /api/health` → `200`.
3. `GET /api/files` returns the project's `.astro` files.
4. `POST /api/dev-server/start` boots the proxy.
5. Kill the binary, expect clean exit.

If any step fails, the artifact is not uploaded.

**Tests**

`packages/server/build/__tests__/binary-smoke.test.ts` runs the same
smoke flow against the *current OS's* artifact, so a developer can
reproduce the CI gate locally without docker.

---

## Step 16 — Editor production bundle served by the server

**Files**

- Edited: `packages/server/src/index.ts` — add static-serve middleware.
- Edited: `packages/editor/package.json` — confirm `build` produces
  `dist/` with no env-specific URLs (Vite default).
- Edited: `packages/server/build/bundle.mjs` — copy
  `packages/editor/dist/` into `build/dist/editor/` after esbuild.

**Approach.** Adds a single mount to `index.ts`:

```ts
// Production: editor bundle ships in the binary's resource dir.
// In tsx dev mode, this directory is empty and Vite (port 3005)
// serves the editor instead — same code path, branch on existence.
const editorDist = path.join(path.dirname(process.execPath), "editor");
if (existsSync(editorDist)) {
  // SPA fallback: serve index.html for any unknown route that isn't
  // /api, /preview, /ws, or /api/injected. Order matters — mount
  // *after* every API route so /api/* still resolves.
  app.use(express.static(editorDist, { index: "index.html" }));
  app.get(/^(?!\/(api|preview|ws)).*/, (_req, res) => {
    res.sendFile(path.join(editorDist, "index.html"));
  });
}
```

**Why this exact order.** All routes are already mounted before this
block (`/api/project`, `/api/files`, …). The static middleware then
catches `/`, `/assets/*`, etc. The SPA-fallback regex catches any
remaining client-side route (e.g. `/sign-in?signed_in=1` after the
OAuth callback redirects back) without intercepting anything API.

**`process.execPath` resolution.**

- In the binary: `process.execPath` is the SEA'd Node, which lives in
  the same directory as `editor/`. Path resolves correctly.
- In `tsx` dev: `process.execPath` is the user's system Node binary,
  which has no sibling `editor/` dir. The `existsSync` check returns
  false; the editor stays on Vite at `:3005` exactly as today.
- In a future Electron build: the desktop shell repackages the server
  binary alongside `editor/` inside `Resources/`, and the lookup
  works the same way.

**Editor base URL.** The Vite build defaults to `base: "/"`. Confirm
no env override sneaks in — the editor must work when served from
`http://localhost:{port}/`. (If a base override is ever needed, it's
a Phase 4 concern, not Phase 3.)

**Tests**

`packages/server/src/routes/__tests__/editor-static.test.ts`:

- With a fixture `dist/` containing `index.html` + `assets/foo.js`,
  `GET /` returns the HTML, `GET /assets/foo.js` returns the JS.
- `GET /unknown-spa-route` returns the same `index.html` (SPA
  fallback).
- `GET /api/health` is **not** intercepted by the SPA fallback.
- Without the fixture (representing dev mode), `GET /` 404s — Vite
  on port 3005 is what the developer is hitting.

---

## Test plan

### Phase 3 unit tests (per file)

- `bundle.test.ts` — esbuild output shape, externals respected.
- `copy-natives.test.ts` — sidecar layout correct per OS.
- `health.test.ts` — `503` while starting, `200` ready.
- `editor-static.test.ts` — static + SPA fallback.

### Phase 3 integration tests

- `binary-smoke.test.ts` (per OS) — boot the produced artifact, run
  the same CI smoke flow described in 15d. CI matrix runs this; a
  developer can run it locally.

### Phase 3 manual verification (one-time per OS, captured in PR)

| Check | How |
|---|---|
| Binary boots on a clean VM with no Node installed | Spin up a fresh Win 11 / macOS / Ubuntu VM, copy `tve-server` + `native/` + `editor/`, run it. |
| `/` serves the production editor | `curl localhost:{port}/` returns Vite-built HTML; opening in a browser shows the toolbar. |
| `/api/health` returns 200 with the right shape | `curl localhost:{port}/api/health \| jq` |
| Mutation round-trip works | Open `test-project`, click an element, change a class, watch the file on disk update. |
| Dev-server proxy works | `POST /api/dev-server/start`, then `GET /preview/index.html` returns the proxied HTML with `<base>` tag. |
| Auth flow works | Set `GITHUB_APP_*` env vars, sign in via the editor, list installations. |

### Regression matrix (must still pass)

- `pnpm dev` on the source tree against `test-project/` works exactly
  as before. The binary path and the source path share 100% of the
  runtime code — only the entry/launch differs.
- All 240+ existing server unit tests pass.
- All 44 broker tests pass (broker is untouched in Phase 3).
- Editor typecheck clean.

---

## Exit criteria

The phase is done when:

1. `pnpm --filter @tve/server build:binary` on each of macOS / Windows
   / Linux produces a working artifact in `build/dist/`.
2. The artifact serves the editor at `/`, the API at `/api/*`, and the
   proxy at `/preview/*` — verified via the smoke test.
3. `/api/health` returns `200` once the boot promise resolves; before
   that, `503` with a `phase: "starting"` body.
4. The state-store boot-failure case actually exits non-zero in
   desktop mode (the P2 follow-up is closed).
5. `tve <path>` source workflow still passes the existing CI job.
6. Universal mac binary (lipo'd from the two arch-specific builds)
   boots cleanly on both Intel and Apple Silicon.
7. CI matrix on `feat/local-saas` is green for at least 24h with the
   binary smoke job included.
8. `docs/plans/follow-ups.md` records any Phase 3 deviations from this
   plan.

## Deviations / risks worth flagging up front

- **SEA + native deps is genuinely a sharp edge.** If a future native
  dep (say a different sqlite library, or a faster Astro compiler)
  doesn't ship Node-22 prebuilds for one OS, that OS's binary build
  is blocked. Mitigated by pinning native-dep versions in
  `package.json` and bumping deliberately, not transitively.
- **Universal mac postject.** `postject` and `codesign` interact
  awkwardly on macOS — postject must run on a stripped/unsigned
  binary, then we re-sign in Phase 5. Phase 3 ships *unsigned* binaries
  for all three OSes; signing is Phase 5's problem. Document this in
  `build/README.md` so a contributor running the script doesn't
  expect a Gatekeeper-clean artifact.
- **Editor `dist/` size.** If the production bundle approaches the
  Node SEA blob size limit (currently ~2 GB but historically buggy
  >1 GB), we would split editor `dist/` out of the SEA and ship as
  files alongside `native/`. This is the more conservative default —
  consider adopting it from day one if the bundle grows >100 MB.
- **WASM in SEA.** `sea.getAsset()` API stability — the API is in
  Node 22, but treat it as experimental until it sees production use.
  If it bites us, fall back to shipping `astro-compiler.wasm` as a
  file in the resource dir, identical to how `editor/` is laid out.
- **`process.execPath` in Electron.** When Phase 4 spawns the server
  via Electron's `utilityProcess.fork()`, `execPath` points at the
  Electron binary, not the SEA'd Node — `editorDist` resolution
  breaks. Fix that in Phase 4 by passing the resource dir as an env
  var (`TVE_RESOURCE_DIR`), preferred over `execPath`. Phase 3 still
  uses `execPath` for the standalone `tve-server` invocation case.

## What this plan does NOT cover

- Code signing, notarization, SmartScreen — Phase 5.
- Auto-update — Phase 5.
- Electron `BrowserWindow`, deep links, keychain — Phase 4.
- Cross-arch builds (Linux ARM, Windows ARM) — backlog.
- Replacing `tsx` for the source workflow — backlog (no need; `tsx`
  is fine for development, the binary covers production).
- Editor build optimizations (code splitting, route-level lazy loads)
  — separate work, not gated by Phase 3.
