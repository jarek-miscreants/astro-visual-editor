import { useEffect, useState } from "react";
import { Github, Loader2, X, AlertTriangle, Lock, Unlock, ExternalLink } from "lucide-react";
import { api } from "../../lib/api-client";
import { ApiError } from "../../lib/api-client";

interface Installation {
  id: number;
  account: { login: string; type: string; avatarUrl: string | null };
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
}

interface Repository {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  pushedAt: string | null;
}

interface Props {
  onClose: () => void;
  onSwitched: () => void;
}

export function GitHubRepoPickerDialog({ onClose, onSwitched }: Props) {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installLoadError, setInstallLoadError] = useState<string | null>(null);
  const [installLoading, setInstallLoading] = useState(true);

  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Load installations on mount
  useEffect(() => {
    let cancelled = false;
    setInstallLoading(true);
    api
      .listGithubInstallations()
      .then(({ installations: list }) => {
        if (cancelled) return;
        setInstallations(list);
        // Auto-select the only installation if there's just one — saves a click.
        if (list.length === 1) {
          setSelectedInstallationId(list[0].id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const e = err as ApiError;
        if (e.status === 401) {
          setInstallLoadError("Not signed in. Click Sign in first.");
        } else {
          setInstallLoadError(e.message || "Failed to load installations");
        }
      })
      .finally(() => {
        if (!cancelled) setInstallLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load repos when an installation is selected
  useEffect(() => {
    if (selectedInstallationId === null) return;
    let cancelled = false;
    setReposLoading(true);
    setRepos([]);
    setReposError(null);
    api
      .listGithubRepositories(selectedInstallationId)
      .then(({ repositories }) => {
        if (cancelled) return;
        setRepos(repositories);
      })
      .catch((err) => {
        if (cancelled) return;
        setReposError((err as Error).message || "Failed to load repositories");
      })
      .finally(() => {
        if (!cancelled) setReposLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInstallationId]);

  // Close on Escape (when nothing's busy)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !opening) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opening, onClose]);

  async function handleOpen(repo: Repository) {
    if (selectedInstallationId === null) {
      setOpenError("No installation selected");
      return;
    }
    setOpening(repo.fullName);
    setOpenError(null);
    try {
      const [owner, name] = repo.fullName.split("/");
      await api.switchProjectToGithub({
        owner,
        repo: name,
        installationId: selectedInstallationId,
        ref: repo.defaultBranch,
      });
      onSwitched();
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "no-broker") {
        setOpenError(
          "Token broker URL isn't set on the server. Add GITHUB_APP_BROKER_URL to .env.local."
        );
      } else if (e.code === "no-private-key") {
        setOpenError(
          "Broker can't mint installation tokens — set GITHUB_APP_PRIVATE_KEY on the Cloudflare Worker."
        );
      } else if (e.code === "broker-token-failed") {
        setOpenError(`Broker rejected token mint: ${e.message}`);
      } else if (e.code === "clone-failed") {
        setOpenError(`Clone failed: ${e.message}`);
      } else if (e.code === "install-failed") {
        setOpenError(`Repo cloned but installing dependencies failed: ${e.message}`);
      } else {
        setOpenError(e.message || "Failed to open repository");
      }
    } finally {
      setOpening(null);
    }
  }

  const selectedInstallation =
    selectedInstallationId !== null
      ? installations.find((i) => i.id === selectedInstallationId)
      : null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !opening) onClose();
      }}
    >
      <div className="w-[640px] max-h-[80vh] flex flex-col border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <Github size={12} className="text-zinc-400" />
            Open from GitHub
          </div>
          <button
            onClick={onClose}
            disabled={!!opening}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto">
          {installLoading && (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-zinc-500">
              <Loader2 size={14} className="animate-spin" />
              Loading installations…
            </div>
          )}

          {installLoadError && (
            <div className="flex items-start gap-2 border-l-2 border-amber-600 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 m-4">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium">{installLoadError}</div>
                {installLoadError.includes("Not signed in") && (
                  <div className="mt-1 text-xs text-amber-200/70">
                    Use the "Sign in" button in the toolbar.
                  </div>
                )}
              </div>
            </div>
          )}

          {!installLoading && !installLoadError && installations.length === 0 && (
            <div className="px-4 py-8 text-sm text-zinc-500">
              <div className="font-medium text-zinc-300">No installations found.</div>
              <div className="mt-1 text-xs">
                Install the TVE App on a GitHub account or organization at{" "}
                <a
                  href="https://github.com/apps/tailwind-visual-editor/installations/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
                >
                  github.com/apps/tailwind-visual-editor
                  <ExternalLink size={10} />
                </a>
                .
              </div>
            </div>
          )}

          {/* Installation picker — only show when >1 */}
          {installations.length > 1 && (
            <div className="border-b border-zinc-800 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Account
              </div>
              <div className="flex flex-wrap gap-2">
                {installations.map((inst) => (
                  <button
                    key={inst.id}
                    onClick={() => setSelectedInstallationId(inst.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs border ${
                      selectedInstallationId === inst.id
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-zinc-800 text-zinc-300 hover:border-zinc-700"
                    }`}
                  >
                    {inst.account.avatarUrl && (
                      <img
                        src={inst.account.avatarUrl}
                        alt=""
                        width={14}
                        height={14}
                        className="rounded-full"
                      />
                    )}
                    {inst.account.login}
                    <span className="text-[9px] uppercase text-zinc-500">
                      {inst.account.type}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected installation banner — only when there's one */}
          {installations.length === 1 && selectedInstallation && (
            <div className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500 flex items-center gap-2">
              {selectedInstallation.account.avatarUrl && (
                <img
                  src={selectedInstallation.account.avatarUrl}
                  alt=""
                  width={14}
                  height={14}
                  className="rounded-full"
                />
              )}
              <span className="text-zinc-400">{selectedInstallation.account.login}</span>
              <span className="text-zinc-600">·</span>
              <span>
                {selectedInstallation.repositorySelection === "selected"
                  ? "selected repos only"
                  : "all repos"}
              </span>
            </div>
          )}

          {/* Repo list */}
          {selectedInstallationId !== null && (
            <div className="px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Repositories
              </div>

              {reposLoading && (
                <div className="flex items-center gap-2 py-4 text-sm text-zinc-500">
                  <Loader2 size={14} className="animate-spin" />
                  Loading…
                </div>
              )}

              {reposError && (
                <div className="border-l-2 border-red-600 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                  {reposError}
                </div>
              )}

              {!reposLoading && !reposError && repos.length === 0 && (
                <div className="text-sm text-zinc-500 py-2">
                  No repositories accessible via this installation.
                </div>
              )}

              <div className="flex flex-col gap-1">
                {repos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-start justify-between gap-3 px-3 py-2 border border-zinc-800 hover:border-zinc-700"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm text-zinc-200">
                        {repo.private ? (
                          <Lock size={11} className="text-zinc-500 flex-shrink-0" />
                        ) : (
                          <Unlock size={11} className="text-zinc-500 flex-shrink-0" />
                        )}
                        <span className="font-medium">{repo.name}</span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {repo.defaultBranch}
                        </span>
                      </div>
                      {repo.description && (
                        <div className="mt-0.5 text-xs text-zinc-500 truncate">
                          {repo.description}
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px] text-zinc-600 font-mono">
                        {repo.fullName}
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpen(repo)}
                      disabled={opening !== null}
                      className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 self-center"
                    >
                      {opening === repo.fullName ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        "Open"
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {opening && (
                <div className="mt-3 border-l-2 border-blue-600 bg-blue-950/30 px-3 py-2 text-xs text-blue-200 flex items-center gap-2">
                  <Loader2 size={11} className="animate-spin flex-shrink-0" />
                  <span>
                    Cloning <span className="font-mono">{opening}</span> and installing dependencies — first open of a repo can take a minute or two.
                  </span>
                </div>
              )}

              {openError && (
                <div className="mt-3 border-l-2 border-amber-600 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                  {openError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-4 py-2 flex items-center justify-between text-[10px] text-zinc-600">
          <a
            href="https://github.com/apps/tailwind-visual-editor/installations/new"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-400 inline-flex items-center gap-1"
          >
            Install on more accounts <ExternalLink size={9} />
          </a>
          <button
            onClick={onClose}
            disabled={!!opening}
            className="hover:text-zinc-400 disabled:opacity-30"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
