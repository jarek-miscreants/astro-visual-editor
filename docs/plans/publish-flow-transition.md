# Publish Flow Transition Plan

Status: draft for review — do not implement.

Companion to `git-integration.md` (the existing 3-branch model) and
`migration-plan.md` (Electron migration). This plan replaces the local
staging-branch concept with host-platform-managed branch previews,
matching the Webflow "staging URL vs custom domain" mental model.

## Goal

Move from a **3-branch local promotion model** (`tve/draft-{slug} →
staging → main`) to a **2-state host-managed model** (one implicit
draft branch, the host's auto-generated preview URL, and the production
branch deploying to the live domain). Drop the local `staging` branch
entirely.

## Why

- **Mental model.** Non-technical users (Webflow refugees) already know
  "staging URL / live domain." They don't know "draft branch / staging
  branch / production branch." Fewer concepts = fewer support tickets.
- **The host already does this.** Cloudflare Pages and Vercel both
  auto-deploy every branch to a unique preview URL. A local `staging`
  branch was reinventing the host's primary feature.
- **Less code.** `services/git.ts` loses `provisionStaging()` and a
  large chunk of `promote()`. `GitPanelDialog.tsx` loses ~100 lines of
  staging-aware branching. `git-store.ts` loses one method.
- **Aligns with host features.** Cloudflare Access / Vercel Deployment
  Protection gate previews if the user wants them private. The host is
  the right place for that policy, not the editor.

## The shift

```
BEFORE
─────────────────────────────────────────────────────────
  tve/draft-{slug}    →    staging    →    main
     working               review          live
     (no deploy)           CF preview      live domain

AFTER
─────────────────────────────────────────────────────────
  tve-draft           →                    main
     working                               live
     host preview URL                      live domain
```

- One implicit `tve-draft` branch per project (configurable name,
  defaulting to `tve-draft`). All TVE edits land here.
- Push → host auto-deploys to a preview URL (Cloudflare Pages or
  Vercel — equivalent, user picks).
- "Publish" = FF-merge `tve-draft` → production branch, push.
- After publish, FF-update `tve-draft` to match production so the next
  edit session starts clean.
- v2 (not in this plan): named drafts as a power feature for users who
  want feature-branch workflows. Off by default.

## What changes

### Backend — `packages/server/src/services/git.ts`

| Remove | Replace with |
|---|---|
| `provisionStaging()` (lines ~342–414) | `provisionDraft()` — creates `tve-draft` from production, pushes |
| Staging branch in `promote()` (lines ~444+) | `publish()` — single FF-merge `tve-draft` → production, push, FF-update `tve-draft` |
| Config field `branches.staging` | Config field `branches.draft` (default `"tve-draft"`) |
| | New: `discardDraft()` — resets `tve-draft` to production (`git reset --hard origin/{production}`) |
| | New: `host.platform`, `host.previewUrlPattern` config for preview URL display |

### Backend — `packages/server/src/routes/git.ts`

| Remove | Replace with |
|---|---|
| `POST /api/git/ensure-staging` | `POST /api/git/ensure-draft` |
| `POST /api/git/promote` (two-step) | `POST /api/git/publish` |
| | `POST /api/git/discard-draft` |

### Editor — `packages/editor/src/components/git/GitPanelDialog.tsx`

- Remove "Set up staging" button (line ~199)
- Remove "Send to Staging" button (line ~212)
- Remove all `stagingBranch` / `stagingExists` / `onStaging` plumbing
  (lines 80–88, 158–159, 399–409, 431)
- Replace with **single "Publish" button** that opens a Publish dialog:
  - Source: `tve-draft`, target: `main`
  - Commits ahead, files changed (existing diff component)
  - Live domain target shown if configured
  - One confirm — no two-step staging hop
- Add **"Discard changes"** secondary action — resets `tve-draft` to
  match production. Confirmed via dialog.
- First-connect prompt: "Set up draft branch" (replaces "Set up
  staging") — single click, creates `tve-draft` from production.

### Editor — `packages/editor/src/store/git-store.ts`

- Remove `promote(...)` action (replaced by `publish()`)
- Add `publish()`, `discardDraft()` actions
- Update branch role detection: `production`, `draft`, `other` (no
  `staging`)

### Config schema — `.tve/config.json`

```diff
 {
   "branches": {
     "production": "main",
-    "staging": "staging",
-    "draftPrefix": "tve/draft-"
+    "draft": "tve-draft"
+  },
+  "host": {
+    "platform": "cloudflare" | "vercel" | null,
+    "previewUrlPattern": "https://{branch}.{project}.pages.dev",
+    "liveDomain": "https://example.com"
   },
   "git": {
     "autoCommitMode": "staged",
     "ffOnly": true,
     "deleteDraftAfterMerge": true
   }
 }
```

**Auto-migration.** On first read of an old-format config:
1. Detect presence of `branches.staging` or `branches.draftPrefix`.
2. Rewrite to new schema (preserving `production` value, dropping
   `staging`, setting `draft` to `"tve-draft"`).
3. Log a one-line warning to stderr (`[TVE] migrated .tve/config.json
   to new schema — see docs/plans/publish-flow-transition.md`).
4. No prompt — silent migration, since the user didn't write that file
   themselves.

### Tests

- `packages/server/src/services/git.test.ts` — drop staging tests, add
  `provisionDraft`, `publish`, `discardDraft`, schema-migration tests.
- New: smoke test `provisionDraft` works against `test-project/`.

### Docs

- **Rewrite** `docs/plans/git-integration.md`. Most of the structure
  stays; the 3-branch sections collapse to 2-state. Branch model
  diagram, first-connect flow, edge cases all need updates. Phased
  delivery sections shrink (no separate "promotion" phase — it folds
  into the "publish" affordance).
- **Update** `docs/plans/migration-plan.md` Phase 2 publish UI scope:
  one button + one dialog, not two. The "PR flow" P2 finding in
  `local-saas-migration.md` simplifies (publish-to-main with optional
  PR fallback for protected branches; no separate "draft → staging" PR
  step).
- **Update** `docs/plans/local-saas-migration.md` — same, drop
  references to staging branch in token-backed git transport scope.

## Branch protection fallback

If `main` (or whatever the user's production branch is) is protected
and rejects direct pushes, `publish()` catches the rejection and:

1. Pushes the merged commit to a temporary branch
   (`tve-publish-{timestamp}`).
2. Opens a PR via GitHub API (using the same token as `git-transport.ts`
   from migration plan Phase 1).
3. Surfaces the PR URL in the Publish dialog with a "View PR" link.
4. Closes the dialog — once the PR merges, the host deploys main.

This is the **only PR flow in v1**. No "draft PR for review before
staging" step. Matches the Webflow model: you publish; if your repo
demands review, you get a PR; otherwise you go straight live.

## Sequencing

This transition should land on **`main`**, not on the
`feat/local-saas` Electron branch. Reasons:

- The change is independent of Electron — current CLI users benefit.
- It removes scope from `feat/local-saas` Phase 2 instead of adding to
  it.
- Smaller blast radius per PR.

Recommended order:

1. **Approve this plan.**
2. **Update docs first** (this plan + git-integration.md rewrite +
   migration-plan.md Phase 2 scope tweak). One PR. No code yet.
3. **Code refactor on `main`.** One feature branch
   (`feat/publish-flow`), one PR:
   - `services/git.ts` + `git.test.ts`
   - `routes/git.ts`
   - `git-store.ts`
   - `GitPanelDialog.tsx` + supporting components
   - Auto-migration for `.tve/config.json`
4. **Rebase `feat/local-saas` onto main.** Pick up the new flow. The
   Phase 0 work (TVE_MODE flag, CI smoke) doesn't touch git code, so
   no conflict.
5. **Resume Electron migration.** Phase 1+ proceeds; Phase 2 publish
   UI is now a much smaller piece of work.

## Estimated scope

| Step | Estimate |
|---|---|
| Doc rewrites | ~half a day |
| `services/git.ts` refactor + tests | ~1 day |
| Route + store updates | ~half a day |
| `GitPanelDialog` + Publish dialog rework | ~1 day |
| Config migration + smoke test | ~half a day |
| Branch protection PR fallback | ~half a day (defer if tight) |

**Total: ~3–4 days of focused work**, branch protection fallback
optional.

## What does NOT change

- File-write-on-mutation behavior (current writes-on-edit semantics).
- The Git panel as a sidebar surface.
- Diff/commit/history UI components.
- Path-guard, file watcher, AST parser, mutation engine.
- Phase 0 work on `feat/local-saas` (TVE_MODE flag, CI smoke).
- The fundamental "TVE writes to your repo, host platform deploys it"
  architecture.

## Open questions

1. **Default draft branch name.** `tve-draft` (proposed) vs
   `tve/draft` (slash-namespaced) vs `draft`. Slash-namespaced is
   tidier for `git branch` listings; `draft` collides with
   user-created branches. Recommendation: `tve-draft`.
2. **Single draft vs named drafts in v1.** Plan assumes single
   implicit draft. If users push back ("I want to test homepage
   redesign without affecting blog edits"), reconsider — but ship
   single first.
3. **Live domain detection.** Pull from CF/Vercel API (requires
   token), or ask the user once and store in
   `host.liveDomain`? Recommendation: store in config; offer
   API-pull as a convenience if a host token is connected.
4. **Preview URL pattern.** Hardcode CF Pages and Vercel patterns or
   require user input? Recommendation: detect from config files
   (`wrangler.toml`, `vercel.json`) and offer a templated default;
   user can override.
5. **What happens to existing users with `staging` branches in their
   repos?** Auto-migration silently drops the field from
   `.tve/config.json`. The branch itself stays — TVE just stops
   referencing it. User can `git branch -d staging` themselves.
6. **Should `discardDraft()` push the reset to origin?** If yes, force
   push is required (rewriting history). Recommendation: yes, with a
   confirmation dialog warning about force push. The `tve-draft`
   branch is owned by TVE; force-pushing it is normal.

## Test gates

- **Doc PR:** rendered diff makes sense, no stale references to
  staging in the updated plans.
- **Code PR:** `git.test.ts` covers `provisionDraft`, `publish`,
  `discardDraft`, schema migration, branch-protection-rejection PR
  fallback. CLI smoke (Phase 0) still green. Manual E2E against a
  real repo with Cloudflare Pages connected: edit → push → preview
  URL appears → Publish → live URL updates.
