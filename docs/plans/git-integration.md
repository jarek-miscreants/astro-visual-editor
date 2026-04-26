# Git Integration Plan

Local-first git workflow for TVE: connect to GitHub repos, edit on isolated draft branches, promote through staging to production, with Cloudflare Pages handling deployment automatically.

## Goals

- TVE becomes git-aware: every edit session lives on a tracked branch, every save is committable, every publish is a push.
- Three-branch promotion model (`draft → staging → main`) modeled on Webflow's staging/published flow.
- Auto-provision missing branches and config on first connect — zero manual git setup for non-technical users.
- Stay local-first. No hosted backend. No new infra. Cloudflare Pages does the deploy work via existing GitHub integration.
- Optional. Projects without git still work.

## Non-goals (v1)

- Hosted SaaS, multi-tenancy, auth, billing.
- GitHub OAuth / GitHub App. Personal Access Tokens stored in OS keychain are sufficient.
- Multi-user simultaneous editing of the same draft.
- Auto-rebase of stale drafts. Manual "Update from main" only.
- Conflict resolution UI. Conflicts surface as errors with a "resolve in your editor" prompt.
- Provisioning the Cloudflare Pages project itself. We document the setup; we don't automate the CF dashboard.

## Branch model

```
tve/draft-{slug}    →    staging    →    main
   (working)             (review)        (live)
        ↑                    ↑                ↑
   "Save Draft"      "Send to Staging"   "Publish to Production"
```

- **Draft branches** are short-lived, named `tve/draft-{slug}` (slug derived from a user-supplied label, e.g. `tve/draft-homepage-redesign`). Branched from `main`, not staging — prevents drafts from inheriting unpublished staged work.
- **Staging** is long-lived. Always in a publishable state. Cloudflare Pages auto-deploys it to `staging.{site}.pages.dev`.
- **Production** (`main` by default — resolved from remote `HEAD`, not hardcoded) is what's live. Cloudflare Pages auto-deploys to the apex domain.

Promotions are forward-only merges. FF-only by default; `--no-ff` merge commit on divergence with explicit user confirmation. Conflicts abort the merge and surface in the UI.

## Operating modes

Local editing is fully retained. Git is additive — nothing in this plan removes or alters the existing "pass a path, edit files, see HMR" flow. The editor operates in one of three modes, auto-detected per project:

| Mode | Trigger | Git panel | Save behavior | Promotion buttons |
|------|---------|-----------|---------------|-------------------|
| **No-git** | Project directory is not a git repo | Hidden; "Initialize git" CTA in project settings | Direct file writes (current behavior) | N/A |
| **Local-only** | Repo exists, no remote configured | Visible; commit + branch ops work, push disabled | File writes + optional local commits | Disabled with tooltip: *"No remote configured. Add a remote to publish."* |
| **Connected** | Repo + remote configured | Full | File writes + commits + push | Full draft → staging → production flow |

### Why local-first stays the primary mode

- **Test-project workflow.** `test-project/` shouldn't need a remote to iterate against.
- **Offline editing.** Edits work without connectivity; sync when back online.
- **Speed.** Local file writes + Vite HMR are sub-100ms. No hosted round-trip can match that.
- **Transparency.** Users can inspect actual file changes on disk before committing — CloudCannon hides this, some users hate that.
- **Migration path.** When/if a hosted version ships, the local app becomes the "pro" tier or BYO-compute escape hatch. It must keep working.

### Write-on-edit, not write-on-commit

Files hit disk immediately on every mutation (current behavior). Git treats them as dirty until committed. The "Save Draft" / "Send to Staging" / "Publish to Production" buttons are **checkpoints over the filesystem**, not gates on it. Rationale:

- HMR-driven preview depends on disk writes.
- Matches developer expectations (every code editor works this way).
- The existing file-watcher already handles external mid-session changes correctly.
- Adds a meaningful "checkpoint" abstraction on top without changing when bytes land.

### Marketing implications (for later)

The local-first fallback is a differentiator vs. CloudCannon-style hosted-only tools:
- *"Your content lives in your repo, on your machine. No vendor lock-in."*
- *"Edit offline, sync when ready."*
- *"Inspect every change in git before publishing."*

These claims should survive into any future hosted version's positioning.

## Config: `.tve/config.json`

Committed to the repo (not app-local state) so multiple users / fresh clones share the same branch model.

```json
{
  "branches": {
    "production": "main",
    "staging": "staging",
    "draftPrefix": "tve/draft-"
  },
  "git": {
    "autoCommitMode": "staged",
    "ffOnly": true,
    "deleteDraftAfterMerge": true
  }
}
```

`autoCommitMode`:
- `"staged"` (default) — mutations write files; user reviews diff and commits a batch via the Git panel.
- `"per-mutation"` — every class change is its own commit. Useful for full-fidelity undo via git log. Noisy, opt-in.

Reading order: `.tve/config.json` → defaults from `tailwind-defaults.ts`-style constants. Missing file = all defaults.

## First-connect flow

When TVE opens a repo, inspect branch state and resolve to one of:

1. **Both `staging` and the remote default branch exist** → use as-is, write `.tve/config.json` if missing, no prompt.
2. **Only the default branch exists** → show one-time setup dialog:
   > *This repo doesn't have a staging branch. TVE uses staging for review-before-publish. Create `staging` from `main` now?*
   > **[Create]** (default) **[Skip]** **[Advanced...]**
   - **Create** runs the auto-provision sequence below.
   - **Skip** falls back to two-branch mode: drafts → main, no staging step. Persisted in config.
   - **Advanced** opens branch-role config: pick which existing branches play production/staging roles, or override the draft prefix.
3. **No remote configured** → warn: *"Local-only repo. Publishing won't deploy anywhere until a remote is added."* Allow staging branch to be created locally regardless.
4. **Repo isn't a git repo at all** → editor works as today, git panel hidden, "Initialize git" CTA in project settings.

### Auto-provision sequence

```
git checkout {production}
git pull --ff-only          # ensure up-to-date; abort if behind and dirty
git checkout -b {staging}
git push -u origin {staging}  # required so CF Pages picks it up
write .tve/config.json
git add .tve/config.json
git commit -m "Configure TVE branch model"
git push
```

Post-success toast:
> *Created `staging` branch. Configure Cloudflare Pages to deploy this branch as a preview.* **[Copy setup instructions]**

The "Copy setup instructions" button copies a templated markdown snippet with the user's branch names filled in.

## Edge cases

| Case | Behavior |
|------|----------|
| Default branch is `master`, not `main` | Resolve via `git symbolic-ref refs/remotes/origin/HEAD`. Don't hardcode `main`. |
| User has uncommitted changes when provisioning | Refuse with clear error: *"Commit or discard your changes on `main` before TVE can set up staging."* No silent stash. |
| `staging` exists locally but not on remote | Push it. Treat as recovery, not error. |
| `staging` exists on remote but not locally | Fetch + create local tracking branch. |
| First push to `staging` returns 403 | Surface the error verbatim. Likely PAT scope (`repo`) or branch protection. Link to GitHub PAT settings. |
| User edits on `main` directly outside TVE | TVE detects when the working tree's branch isn't a `tve/draft-*` branch and warns: *"You're editing on `main`. Create a draft branch first?"* with a one-click fix. |
| Two drafts touch the same file | First merge to staging succeeds; second shows "draft is behind staging" with **[Update from staging]** button. Conflicts during update abort with "resolve in your editor". |
| User deletes a draft branch outside TVE | Detected on next refresh; remove from draft picker silently. |
| No `gh` CLI installed | Fall back to GitHub API with the stored PAT for "Open PR" action. |

## Architecture

### New backend module

```
packages/server/src/services/git.ts
```

Wraps `simple-git` (Node library — no shelling out, cross-platform). Surface area:

- `status()` — branch, ahead/behind counts, dirty file list, current draft slug
- `getBranches()` — local + remote branches, default branch, current branch
- `createDraft(slug)` — branches from production, checks out
- `commit(message, files?)` — stages and commits; if `files` omitted, commits all dirty
- `push(branch?, setUpstream?)` — pushes with optional `-u`
- `pull(branch, mode)` — `mode: 'ff-only' | 'merge' | 'rebase'`
- `merge(from, to, options)` — promotion primitive; FF-only with fallback
- `discardDraft(slug)` — deletes local + remote draft branch
- `provisionStaging()` — runs the auto-provision sequence above
- `readConfig()` / `writeConfig()` — `.tve/config.json` I/O
- `setRemote(url)`, `clone(url, dest)` — for future "clone from URL" flow

### New routes

```
GET    /api/git/status                    → branch, ahead/behind, dirty files
GET    /api/git/branches                  → branch list + roles (production/staging/draft)
POST   /api/git/draft                     → { slug } create draft branch
DELETE /api/git/draft/:slug               → discard draft
POST   /api/git/commit                    → { message, files? }
POST   /api/git/push                      → { branch?, setUpstream? }
POST   /api/git/pull                      → { branch, mode }
POST   /api/git/promote                   → { from, to } promote (merge + push)
POST   /api/git/provision-staging         → run first-connect setup
GET    /api/git/config                    → read .tve/config.json
PUT    /api/git/config                    → write .tve/config.json
GET    /api/git/diff                      → diff for review-before-commit panel
```

All routes funneled through `path-guard` (operate on the active project root only).

### Auth storage

PAT stored in OS keychain via `keytar` (already a Node-friendly cross-platform wrapper). Key: `tve:github:pat:{username}`. Never written to disk in plaintext, never logged. PAT only needed for push/pull over HTTPS; SSH-configured repos work with no PAT.

A small "GitHub Account" panel in project settings:
- Connect (paste PAT, validate via `GET /user`)
- Show connected username + scopes
- Disconnect (removes from keychain)

### Editor frontend

New panel: a 4th sidebar tab next to **Tree / Properties / Design System**, called **Git**. Or — better for marketers — a **persistent toolbar widget** + **modal** for promotions. Recommendation: do both.

```
packages/editor/src/components/git/
  GitToolbarWidget.tsx       — branch chip, dirty count, draft picker dropdown
  GitPanel.tsx               — full diff/commit/history view (sidebar tab)
  PromotionDialog.tsx        — "Send to Staging" / "Publish to Production" modal
  NewDraftDialog.tsx         — name + create draft
  DiscardDraftDialog.tsx     — confirm destructive
  ProvisionStagingDialog.tsx — first-connect setup
  GitHubAuthPanel.tsx        — PAT connect (in project settings)
```

New store: `packages/editor/src/store/git-store.ts`. Holds branch state, dirty file list, current draft, sync status. Polls `/api/git/status` on focus + after every mutation batch (debounced, 500ms).

### UI surfaces

**Toolbar widget (always visible):**
```
[ branch icon ] tve/draft-homepage-redesign ▾   • 12 changes   [Save Draft]   [Send to Staging]
```
- Branch chip dropdown: switch drafts, create new draft, discard draft, jump to `main` (read-only mode)
- Dirty count: clicking opens the Git panel scrolled to file diff
- "Save Draft" button: opens commit dialog (message + diff preview)
- "Send to Staging" / "Publish to Production": opens promotion dialog

**Promotion dialog:**
- Source → target branch summary
- Commits ahead (count + log)
- Files changed (list with diff toggle)
- Where it deploys (e.g. *"Will deploy to `staging.example.pages.dev`"*) — uses CF Pages API if connected, otherwise shows the templated URL pattern from config
- "After publish: delete draft branch" checkbox (defaulted from config)
- **[Cancel]** **[Publish]**

**Git panel (sidebar):**
- Branch info card (same as toolbar widget, expanded)
- Pending changes list (toggleable diff per file)
- Commit message input + Commit button
- Recent commits log (last 20, with revert button on each)
- Sync status: ahead/behind, **[Pull]** if behind, last fetch time

## Cloudflare Pages integration (optional, v1.5)

The branch model works without any CF integration — CF auto-builds on push regardless. But the deploy-status badge is what makes it *feel* like Webflow.

Optional API integration:
- **Token entry** in project settings (CF API token with `Pages:Edit` scope)
- **Deploy status polling** — `GET /accounts/{id}/pages/projects/{name}/deployments` after every push, surface latest deployment status (`queued / building / success / failure`) per branch as a badge
- **Preview URL display** in the promotion dialog and toolbar
- **"View deploy logs"** link

Skip for v1 if scope is tight; ship deploy badges in v1.5.

## Phased delivery

### Phase A — Local git foundation (~3–4 days)
- `git.ts` service wrapping `simple-git`
- Routes: `/api/git/status`, `/api/git/branches`, `/api/git/commit`, `/api/git/push`, `/api/git/pull`, `/api/git/diff`, `/api/git/config`
- `git-store.ts`
- Toolbar widget (branch chip, dirty count, save button)
- Git panel (diff + commit)
- Works only on the currently-checked-out branch, no draft/promotion logic yet
- **Ship criterion:** can edit a page in TVE, see the diff in the Git panel, write a commit message, commit, and push. Verified against a test repo.

### Phase B — Branch model + drafts (~2–3 days)
- `.tve/config.json` read/write
- Draft branch creation/switching/discarding
- Draft picker UI in toolbar
- `provisionStaging()` first-connect flow + dialog
- Detect "editing on production" warning
- **Ship criterion:** opening a fresh repo prompts staging setup, draft creation works, switching between drafts is one click.

### Phase C — Promotion flow (~2 days)
- `promote(from, to)` route + merge logic (FF-only with fallback)
- PromotionDialog with commit summary + file diff
- "Send to Staging" and "Publish to Production" buttons
- Conflict handling: abort with clear error message
- Optional auto-delete-draft after merge
- **Ship criterion:** full draft → staging → main flow round-trips on a real repo with a CF Pages connection. Pushing triggers a CF build (verified manually).

### Phase D — GitHub auth + PR option (~1–2 days)
- `keytar`-based PAT storage
- GitHubAuthPanel in project settings
- Validate PAT on save, show username + scopes
- "Open PR" button on promotion dialog (uses PAT, falls back to `gh` CLI if available)
- **Ship criterion:** non-SSH repos work end-to-end without manual git CLI use.

### Phase E — CF Pages status badges (~1–2 days, optional)
- CF API token entry in project settings
- Deployment polling for staging + production branches
- Status badges in toolbar + promotion dialog
- Preview URLs surfaced everywhere relevant
- **Ship criterion:** after publishing, user sees "building..." → "live" without leaving TVE.

### Phase F — Polish + edge cases (~2 days)
- "Update draft from staging" / "Update draft from main" actions
- Recent-repos list / "open recent project" UX
- "Clone from URL" entry point (uses `git.clone()`)
- Better error surfacing for 403 / branch protection / dirty-tree edge cases
- Documentation: README section + in-app help links

**Total: ~10–14 days of focused work for the full plan, ~6–8 days to a usable Phase A+B+C MVP.**

## Risks & open questions

- **Windows path handling.** `simple-git` is generally fine but git's autocrlf behavior + Astro file writes need a smoke test. Likely a half-day of fixes when we hit it.
- **`magic-string` mutations + git index churn.** Per-mutation auto-commit will explode commit history fast. Default to staged mode; gate per-mutation behind explicit opt-in.
- **What happens if a CF Pages build fails?** v1: link to CF dashboard. v2: surface log tail in TVE. Don't block edits while build is failing.
- **Multi-user same-draft.** Out of scope for v1, but the draft-prefix scheme means two users naming drafts identically would collide. Suggest including username in the prefix once we go multi-user (`tve/draft-{user}-{slug}`).
- **Should `.tve/config.json` be `.tve/config.yml` instead?** YAML is friendlier for humans editing it directly; JSON is simpler for tooling. JSON is fine for v1; switch to YAML if users complain.
- **Branch protection rules on `main`.** If the production branch is protected and requires PRs, "Publish to Production" should detect that and create a PR instead of trying to push directly. Detection: try the merge, catch the rejection, fall back to PR flow. Worth implementing in Phase D alongside the PR support.

## Success criteria

A non-technical user can:
1. Connect TVE to a GitHub repo with no prior git knowledge.
2. Make visual edits and see them appear in a diff panel.
3. Save a draft and know that nothing has shipped yet.
4. Promote a draft to staging and see it on a staging URL within ~1 min.
5. Publish staging to production with a confirmation step and see it live within ~1 min.
6. Discard a bad draft without affecting staging or production.
7. Never see the words "rebase," "merge conflict," or "remote tracking branch" unless something is genuinely wrong.

If all seven hold, the local-app phase is done and the next conversation is "what does this look like as a hosted product."
