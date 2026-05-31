# GitHub App Registration — Handoff to Miscreants Org Owner

**From:** Jarek
**To:** Miscreants org owner (admin)
**Estimated time:** 15–20 minutes
**Why I can't do it myself:** registering a GitHub App under an org requires Owner or Admin role, which I don't have on `Miscreants`.

---

## What this is

I'm building **Tailwind Visual Editor (TVE)** — a desktop tool that
visually edits Astro + Tailwind projects with real source-file sync.
For users to be able to **sign in with GitHub, pick a repo, clone it,
edit visually, and push back**, TVE needs a registered GitHub App.

GitHub Apps are the standard, recommended way for tools to integrate
with users' repos on their behalf — same model used by Vercel,
Netlify, Linear's GitHub integration, etc. The App needs to be owned
by an account; we want that account to be **Miscreants** (not my
personal GitHub) so the integration is branded under the company.

The App's source code (TVE itself) does not need to live under
Miscreants — it stays in my personal account for now. **Only the App
registration is being moved to Miscreants.**

---

## What I'm asking you to do

Three things:

1. Register the GitHub App in Miscreants's org settings using the
   exact values below.
2. Generate a client secret and a private key.
3. Send back the public identifiers (any channel) and the secrets
   (secure channel only — 1Password share, encrypted email, Signal).

After this, I handle everything else: deploying the token broker,
wiring it into TVE, etc. You won't need to touch this again unless
we ever need to rotate keys or change permissions.

---

## Step-by-step

### 1. Open the new-App page

Go to **`https://github.com/organizations/Miscreants/settings/apps/new`**

(If you only see a list of existing apps and no "New GitHub App"
button, the URL above bypasses that.)

### 2. Fill in the form

| Field | Value |
|---|---|
| **GitHub App name** | `Tailwind Visual Editor` (or `tve` if that's taken — names are global across GitHub) |
| **Homepage URL** | `https://github.com/jarek-miscreants/astro-visual-editor` (TVE's source repo) |
| **Description** | `Visual editor for Astro + Tailwind projects with real source-file sync.` |
| **Identifying and authorizing users → Callback URL** | `http://localhost:3011/api/auth/github/callback` |
| **Add another callback URL** (button below the first) | `tve://auth/callback` |
| **Request user authorization (OAuth) during installation** | ✅ **Check** |
| **Expire user authorization tokens** | ✅ Check (default; rotation is good practice) |
| **Webhook → Active** | ❌ **Uncheck** — TVE doesn't subscribe to events |
| **Webhook URL / Webhook secret** | Leave empty (greyed out when Active is unchecked) |

### 3. Permissions

Under **Repository permissions** — set these, leave everything else
on "No access":

| Permission | Access | Why |
|---|---|---|
| **Contents** | Read & write | Read source files into the editor; commit + push edits back |
| **Metadata** | Read | Auto-required when any other permission is set |
| **Pull requests** | Read & write | Future PR-creation flow (planned for v0.2) |
| **Workflows** | Read | Detect CI configs (informational only — TVE doesn't modify workflows) |

Under **Account permissions**:

| Permission | Access | Why |
|---|---|---|
| **Email addresses** | Read | For git author info on commits made via TVE |

That's it. **No admin-level permissions, no org-level permissions,
no webhooks** — TVE never sees user activity it wasn't explicitly
asked to perform.

### 4. Where can this GitHub App be installed?

Pick **"Any account"** so users outside Miscreants can use TVE when
we ship publicly. (You can flip this to "Only on this account" later
if we want to lock it down — it's reversible.)

### 5. Click "Create GitHub App"

GitHub takes you to the new App's settings page. Almost done.

### 6. Generate the client secret

Still on the App's settings page, scroll to **Client secrets** →
click **"Generate a new client secret"**.

⚠️ **Copy it immediately** — it's only shown once. Save in 1Password
or your password manager.

### 7. Generate the private key

Scroll to **Private keys** → click **"Generate a private key"**.
A `.pem` file downloads automatically. Save it securely — same as
the client secret, this is sensitive.

(The private key file is regenerable — if you lose it, generate a
new one and the old one immediately stops working. Only one is
"active" at a time, but you can have multiples to support rotation.)

### 8. Send me the values

#### Public values — any channel is fine (Slack, email, etc.)

Find these on the App's settings page (top of the page + "About"
section):

- **App ID:** _(a number, e.g. `1234567`)_
- **Client ID:** _(a string starting with `Iv23li...`)_
- **App slug:** _(the URL part — visible at `github.com/organizations/Miscreants/settings/apps/{slug}`)_

#### Secrets — secure channel only

These should NEVER go through Slack DM, email, or any other plaintext
channel. Use one of:

- **1Password** secure share link (preferred)
- **Bitwarden Send**
- **Signal** disappearing message
- **Encrypted email** (PGP) if you're set up for it

What to send:

- **Client secret** — the string from step 6
- **Private key** — the entire contents of the `.pem` file from step 7

That's it from your side. I'll handle the rest.

---

## What I'll do with these

1. **Public values** (App ID, Client ID, slug) → committed into TVE's
   integration docs so future contributors can see what App TVE
   talks to.
2. **Secrets** (private key, client secret) → loaded into a small
   Cloudflare Worker (the "token broker") that I'll deploy. The
   broker is the only place these secrets live. TVE itself never
   sees them — it just calls the broker when a user is signing in.
3. The broker exchanges OAuth codes and mints short-lived
   installation tokens. TVE uses those tokens for git operations.
4. Standard model — same pattern Vercel, Netlify, etc. use for their
   GitHub integrations.

---

## Reversibility

If anything ever goes wrong:

- **Rotate the private key:** generate a new one in App settings →
  give me the new file → I redeploy the broker. ~5 minutes.
- **Rotate the client secret:** same process. ~5 minutes.
- **Revoke a single user's access:** they uninstall the App from
  their account. You don't have to do anything.
- **Pause everything:** delete the GitHub App. All user sessions
  invalidate immediately. We can re-register a fresh one whenever
  ready.

The Miscreants org always retains full control. I never have admin
access to the App — only the Miscreants owners do.

---

## Questions you might have

**Q: Why does TVE need write access to repo contents?**
A: TVE *is* a source editor — its core feature is committing edits
back to the user's repo. Without write access, the only function
TVE performs is broken.

**Q: Why is the webhook disabled? Don't real GitHub Apps use them?**
A: Webhooks let an App receive notifications when something happens
in a user's repo (push, PR, issue, etc.). TVE has no need to be
notified — it only acts when the user clicks something in the
editor. Keeping webhooks off means TVE has no "background presence"
in user repos.

**Q: Will Miscreants get notified if a user revokes access?**
A: No. Revocations happen quietly between the user and GitHub. The
user's installation token simply stops working; TVE handles the
401 by prompting them to sign in again.

**Q: What's the second callback URL `tve://auth/callback` for?**
A: When TVE eventually ships as a desktop app (Electron), the OS
needs a way to forward the GitHub login callback back into the app.
Custom protocol handlers like `tve://` are the standard mechanism.
We register it now so we don't have to come back and modify the
App later. Until then, only the `localhost` callback is used.

**Q: Can I see the broker's source code?**
A: Yes — it'll live in a public repo when deployed (~50 lines of
TypeScript). I'll share the link once it's up.

---

Thanks. Once I have the values back, the rest of the integration
takes a couple days of my work, no further input from you.
