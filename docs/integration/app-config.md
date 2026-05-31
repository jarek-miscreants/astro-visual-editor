# GitHub App configuration

Single source of truth for which GitHub App TVE talks to. Public
identifiers are documented here; secrets live only in the token broker.

## Current registration — personal-test App

Owned by `@jarek-miscreants`. Used for development and local end-to-end
testing while the production registration is in flight.

| Field | Value |
|---|---|
| App settings page | <https://github.com/settings/apps/tailwind-visual-editor> |
| App ID | `3625760` |
| Client ID | `Iv23liYBl4uHyTNnpQzO` |
| Slug | `tailwind-visual-editor` |
| Owner type | Personal account |
| Install scope | Only on this account (planned — verify in App settings) |

The client secret and private key for this App live exclusively in:
- the App owner's password manager (recovery copy);
- the dev token broker's secret store (`wrangler secret put` —
  `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY`).

Neither value is checked into git, environment files, or chat
transcripts.

## Future registration — Miscreants org App

Two paths land in the same end state:

### Path A — Transfer ownership (preferred when feasible)

GitHub allows transferring App ownership between accounts. This
preserves the App ID, Client ID, slug, and all existing installations.

1. From the personal App settings → "Transfer ownership" → enter
   `Miscreants` as the new owner.
2. A Miscreants org owner accepts the transfer in their org's
   notifications.
3. After transfer:
   - App ID stays `3625760`.
   - Client ID stays `Iv23liYBl4uHyTNnpQzO`.
   - Slug stays `tailwind-visual-editor`.
   - All user installations remain valid.
   - The org owner (not Jarek) now controls the App's secrets.
4. Rotate the client secret and private key after transfer. The new
   owner generates them and re-runs `wrangler secret put` against the
   production broker.

**TVE code change required:** none — the public values don't change.

### Path B — Re-register from scratch

If transfer isn't viable (e.g. policy reasons), follow the runbook in
`docs/integration/github-app-handoff.md` to register a fresh App under
the Miscreants org. This produces a new App ID + Client ID + slug.

**TVE code change required:** update three values in production
`.env` + redeploy the broker with new secrets. The
`syncAppContext` guard in `state-store.ts` automatically clears
stale `installations` and `repos` rows on any user's machine the first
time they run TVE against the new App ID.

## Local development

1. Copy `packages/server/.env.example` to `packages/server/.env.local`.
2. Fill in `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_SLUG`
   with the values from the table above (or your own personal App).
3. Set `GITHUB_APP_BROKER_URL` to the dev broker URL once it's
   deployed (leave unset until then).
4. `pnpm dev` auto-loads `.env.local` via Node's
   `--env-file-if-exists` flag.

`.env.local` is gitignored (`.env` and `*.local` patterns).

## Operational notes

- The TVE server never holds the App's client secret or private key.
  Those live only in the Cloudflare Worker (token broker). The
  separation is locked in `phase-0-decisions.md` §1.
- App callback URLs registered on every TVE App registration:
  - `http://localhost:3011/api/auth/github/callback`
  - `tve://auth/callback`
- "Request user authorization (OAuth) during installation" must be
  enabled — Phase 2 sign-in depends on it.
- Webhooks are intentionally disabled. TVE never subscribes to repo
  events.
