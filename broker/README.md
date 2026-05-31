# tve-broker

Cloudflare Worker that brokers GitHub App OAuth code exchange and (Phase 2) installation token minting for the Tailwind Visual Editor.

The architectural rationale lives in `../docs/plans/phase-0-decisions.md` §1: this is the **single place** the GitHub App's client secret + private key live. The TVE server itself never sees them.

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Health check. |
| `POST` | `/oauth/exchange` | Body: `{ code, redirectUri? }` → returns the GitHub user access token JSON. |
| `POST` | `/installations/:id/token` | (Phase 2) Mint an installation access token. |

## Setup

1. **Authenticate** the wrangler CLI: `wrangler login`. One-time per machine.
2. **Set secrets** — these never go in `wrangler.toml` or git:
   ```powershell
   wrangler secret put GITHUB_APP_CLIENT_SECRET
   # paste the rotated client secret when prompted

   Get-Content path\to\app.pem | wrangler secret put GITHUB_APP_PRIVATE_KEY
   # piped from the .pem file so it never appears in your shell history
   ```
3. **Deploy:** `pnpm deploy` (wraps `wrangler deploy`). The first deploy prints a `https://tve-broker-{your-name}.workers.dev` URL — copy it.
4. **Tell the TVE server about it.** In `../packages/server/.env.local`:
   ```
   GITHUB_APP_BROKER_URL=https://tve-broker-{your-name}.workers.dev
   ```

## Local development

`pnpm dev` runs the Worker on `http://localhost:8787` via `wrangler dev`. Set `GITHUB_APP_BROKER_URL=http://localhost:8787` in the server's `.env.local` to point at it.

`wrangler dev` reads secrets from `.dev.vars` (gitignored). A minimal `.dev.vars` for local testing:

```
GITHUB_APP_CLIENT_SECRET=your-rotated-secret-here
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**Never commit `.dev.vars`.**

## Testing

`pnpm test` — vitest, mocked `fetch`, no network. Covers happy path, missing code, GitHub error, network failure, malformed responses.

## Swap-to-production checklist

When the App is transferred to (or re-registered under) the Miscreants org:

1. Update `[vars] GITHUB_APP_CLIENT_ID` in `wrangler.toml` if the Client ID changed.
2. `wrangler secret put GITHUB_APP_CLIENT_SECRET` with the new secret.
3. `wrangler secret put GITHUB_APP_PRIVATE_KEY` with the new .pem.
4. `pnpm deploy`.
5. Update `GITHUB_APP_BROKER_URL` in TVE server config if the Worker URL changed (it shouldn't if the Worker name stays the same).

The TVE server's state-store invalidation guard (`syncAppContext`) handles dropping stale installation IDs on each user's machine automatically the first time they hit the new App.
