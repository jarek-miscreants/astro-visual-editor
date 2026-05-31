import { Router } from "express";
import { getCurrentAccessToken } from "./auth.js";

/**
 * Read-side GitHub API proxy. Uses the signed-in user's access token
 * (stored by `routes/auth.ts`) to call api.github.com on their behalf.
 *
 * Routes
 *   GET /api/github/installations
 *     → list of GitHub App installations the signed-in user has access to
 *   GET /api/github/installations/:id/repositories
 *     → list of repos accessible to the App via that installation
 *
 * Both endpoints require sign-in. Returns 401 with code="not-signed-in"
 * when no token is stored.
 */

export const githubRouter = Router();

interface InstallationListItem {
  id: number;
  account: { login: string; type: string; avatarUrl: string | null };
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
}

interface RepositoryListItem {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  pushedAt: string | null;
}

githubRouter.get("/installations", async (_req, res) => {
  const token = getCurrentAccessToken();
  if (!token) {
    res
      .status(401)
      .json({ error: "Not signed in", code: "not-signed-in" });
    return;
  }

  try {
    const ghRes = await fetch("https://api.github.com/user/installations", {
      headers: githubHeaders(token),
    });
    if (!ghRes.ok) {
      res.status(ghRes.status).json({
        error: `GitHub returned ${ghRes.status}`,
        code: "github-error",
        detail: await ghRes.text().catch(() => ""),
      });
      return;
    }
    const data = (await ghRes.json()) as {
      installations?: Array<Record<string, unknown>>;
    };
    const installations: InstallationListItem[] = (data.installations ?? []).map(
      (i) => ({
        id: Number(i.id),
        account: {
          login: String((i.account as Record<string, unknown> | null)?.login ?? ""),
          type: String((i.account as Record<string, unknown> | null)?.type ?? ""),
          avatarUrl:
            typeof (i.account as Record<string, unknown> | null)?.avatar_url === "string"
              ? ((i.account as Record<string, unknown>).avatar_url as string)
              : null,
        },
        repositorySelection:
          i.repository_selection === "selected" ? "selected" : "all",
        permissions:
          typeof i.permissions === "object" && i.permissions !== null
            ? (i.permissions as Record<string, string>)
            : {},
      })
    );
    res.json({ installations });
  } catch (err) {
    res.status(502).json({
      error: "Failed to reach api.github.com",
      code: "github-unreachable",
      detail: (err as Error).message,
    });
  }
});

githubRouter.get("/installations/:id/repositories", async (req, res) => {
  const token = getCurrentAccessToken();
  if (!token) {
    res
      .status(401)
      .json({ error: "Not signed in", code: "not-signed-in" });
    return;
  }

  const installationId = Number(req.params.id);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    res.status(400).json({ error: "Invalid installation id", code: "bad-id" });
    return;
  }

  try {
    // Per-page max for this endpoint is 100. Phase 1 fetches the first
    // page only — if a user has >100 repos in one installation, follow-up
    // work paginates. Practical: most installations have <50 repos.
    const ghRes = await fetch(
      `https://api.github.com/user/installations/${installationId}/repositories?per_page=100`,
      { headers: githubHeaders(token) }
    );
    if (!ghRes.ok) {
      res.status(ghRes.status).json({
        error: `GitHub returned ${ghRes.status}`,
        code: "github-error",
        detail: await ghRes.text().catch(() => ""),
      });
      return;
    }
    const data = (await ghRes.json()) as {
      repositories?: Array<Record<string, unknown>>;
    };
    const repositories: RepositoryListItem[] = (data.repositories ?? []).map(
      (r) => ({
        id: Number(r.id),
        name: String(r.name),
        fullName: String(r.full_name),
        defaultBranch: String(r.default_branch ?? "main"),
        private: Boolean(r.private),
        description: typeof r.description === "string" ? r.description : null,
        htmlUrl: String(r.html_url),
        pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : null,
      })
    );
    res.json({ repositories });
  } catch (err) {
    res.status(502).json({
      error: "Failed to reach api.github.com",
      code: "github-unreachable",
      detail: (err as Error).message,
    });
  }
});

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tve-server",
  };
}
