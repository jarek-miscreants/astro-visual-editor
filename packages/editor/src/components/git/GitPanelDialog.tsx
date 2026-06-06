import { useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  GitCommit,
  X,
  Loader2,
  ArrowUpFromLine,
  ArrowDownToLine,
  AlertCircle,
  FileText,
  Plus,
  Minus,
  Pencil,
  HelpCircle,
  ChevronDown,
  Send,
  Rocket,
  Sparkles,
  Check,
  ShieldCheck,
} from "lucide-react";
import { useGitStore } from "../../store/git-store";
import { useModeStore } from "../../store/mode-store";
import { useAuthStore } from "../../store/auth-store";
import type { GitDirtyFile, GitDiffEntry } from "@tve/shared";
import { Tooltip } from "../ui/Tooltip";

interface Props {
  onClose: () => void;
}

/**
 * Modal git panel: branch info, dirty file list with diffs, commit input,
 * push/pull, recent commits. v1 surface — promotion (draft → staging → main)
 * lands in Phase B/C.
 */
export function GitPanelDialog({ onClose }: Props) {
  const status = useGitStore((s) => s.status);
  const branches = useGitStore((s) => s.branches);
  const config = useGitStore((s) => s.config);
  const diff = useGitStore((s) => s.diff);
  const commits = useGitStore((s) => s.commits);
  const busy = useGitStore((s) => s.busy);
  const refresh = useGitStore((s) => s.refresh);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const loadCommits = useGitStore((s) => s.loadCommits);
  const loadBranches = useGitStore((s) => s.loadBranches);
  const loadConfig = useGitStore((s) => s.loadConfig);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const checkout = useGitStore((s) => s.checkout);
  const ensureStaging = useGitStore((s) => s.ensureStaging);
  const promote = useGitStore((s) => s.promote);
  const userMode = useModeStore((s) => s.userMode);
  const signedIn = useAuthStore((s) => s.signedIn);
  const user = useAuthStore((s) => s.user);

  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [forcePrompt, setForcePrompt] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    refresh();
    loadDiff();
    loadCommits();
    loadBranches();
    loadConfig();
  }, [refresh, loadDiff, loadCommits, loadBranches, loadConfig]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const dirty = status?.dirty || [];
  const isLocalOnly = status?.mode === "local-only";
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const currentBranch = status?.currentBranch || null;
  const productionBranch = config?.branches.production || status?.defaultBranch || "main";
  const stagingBranch = config?.branches.staging || "staging";
  const productionMode = config?.publishing?.productionMode || "admins-only";
  const defaultTarget = config?.publishing?.defaultTarget || "staging";
  const githubLogin = user?.login || null;
  const admins = config?.roles?.admins || [];
  const publishers = config?.roles?.publishers || [];
  const reviewers = config?.roles?.reviewers || [];
  const roleConfigEmpty = admins.length === 0 && publishers.length === 0 && reviewers.length === 0;
  const isAdmin = roleMatches(admins, githubLogin);
  const isPublisher = isAdmin || roleMatches(publishers, githubLogin);
  const isReviewer = isPublisher || roleMatches(reviewers, githubLogin);
  const devModeFallback = roleConfigEmpty && userMode === "dev";
  const canUseProduction =
    productionMode === "anyone" ||
    (productionMode === "any-signed-in" && signedIn) ||
    (productionMode === "admins-only" && isAdmin) ||
    devModeFallback;

  const localBranches = useMemo(() => branches.filter((b) => b.hasLocal), [branches]);
  const stagingExists = useMemo(
    () => branches.some((b) => b.name === stagingBranch),
    [branches, stagingBranch]
  );
  const onProduction = currentBranch === productionBranch;
  const onStaging = currentBranch === stagingBranch;
  const publishCurrentBranchRestricted = onProduction && !canUseProduction;

  async function handleCommit() {
    const trimmed = message.trim();
    if (!trimmed || dirty.length === 0) return;
    const ok = await commit(trimmed);
    if (ok) setMessage("");
  }

  /**
   * One-click "save and ship" — the only verb a marketer needs. If
   * there are uncommitted changes, commit them with an auto-message;
   * then push if there's anything ahead of remote.
   *
   * Disabled when there's nothing to do (clean tree + 0 ahead).
   */
  async function handlePublish() {
    if (dirty.length > 0) {
      const auto = `Edits from TVE — ${new Date().toLocaleString()}`;
      const ok = await commit(auto);
      if (!ok) return;
    }
    // After commit, status updates; push handles 0-ahead as a no-op
    // gracefully. Cheaper to just call push than to re-read status.
    await push();
  }

  const canPublish =
    !busy &&
    !isLocalOnly &&
    !publishCurrentBranchRestricted &&
    (dirty.length > 0 || ahead > 0);
  const publishLabel = onProduction
    ? "Publish Main"
    : onStaging
    ? "Publish Staging"
    : "Push Branch";
  const publishTooltip = isLocalOnly
    ? "No remote configured"
    : publishCurrentBranchRestricted
    ? productionAccessMessage({
        mode: productionMode,
        signedIn,
        githubLogin,
        roleConfigEmpty,
        productionBranch,
      })
    : dirty.length > 0
    ? `Commit and push ${currentBranch || "current branch"}`
    : ahead > 0
    ? `Push ${currentBranch || "current branch"} to origin`
    : "Nothing to publish";
  const roleLabel = devModeFallback
    ? "dev"
    : isAdmin
    ? "admin"
    : isPublisher
    ? "publisher"
    : isReviewer
    ? "reviewer"
    : signedIn && githubLogin
    ? githubLogin
    : "signed out";
  const roleTooltip = (
    <div className="flex max-w-[360px] flex-col gap-1 text-left leading-relaxed">
      <span>
        <span className="font-semibold text-zinc-100">Who defines roles?</span>{" "}
        The project owner, lead developer, or repo admin edits{" "}
        <span className="font-mono text-zinc-100">.tve/config.json</span>.
      </span>
      <span>
        Add GitHub usernames to{" "}
        <span className="font-mono text-zinc-100">roles.admins</span>,{" "}
        <span className="font-mono text-zinc-100">roles.publishers</span>, or{" "}
        <span className="font-mono text-zinc-100">roles.reviewers</span>. TVE uses those
        lists to shape the UI only.
      </span>
      <span>
        Anyone with a local checkout can edit this file for themselves. That does not grant
        repo permission; GitHub branch protection, CODEOWNERS, and push permissions still
        decide what reaches staging or production.
      </span>
      <span className="text-zinc-400">
        Current TVE role: {roleLabel}. Default content target: {defaultTarget}.
        {roleConfigEmpty ? " No roles are configured yet; dev mode keeps production controls available." : ""}
      </span>
    </div>
  );
  const stagingTooltip = !currentBranch
    ? "No current branch"
    : isLocalOnly
    ? "No remote configured"
    : onStaging
    ? `You're already on ${stagingBranch}`
    : onProduction
    ? "Switch to a feature branch first"
    : dirty.length > 0
    ? "Commit changes before sending to staging"
    : `Merge ${currentBranch} -> ${stagingBranch}${stagingExists ? " and push" : " (creates staging first)"}`;
  const productionTooltip = !currentBranch
    ? "No current branch"
    : isLocalOnly
    ? "No remote configured"
    : onProduction
    ? `You're already on ${productionBranch}`
    : dirty.length > 0
    ? "Commit changes before publishing to production"
    : !canUseProduction
    ? productionAccessMessage({
        mode: productionMode,
        signedIn,
        githubLogin,
        roleConfigEmpty,
        productionBranch,
      })
    : `Merge ${onStaging || !stagingExists ? currentBranch : stagingBranch} -> ${productionBranch} and push`;

  async function handleSendToStaging() {
    if (!currentBranch) return;
    let target = stagingBranch;
    if (!stagingExists) {
      const result = await ensureStaging();
      if (!result) return;
      target = result.name;
    }
    const outcome = await promote({ from: currentBranch, to: target, ffOnly: true });
    if (outcome.kind === "needs-merge-commit") {
      setForcePrompt({ from: currentBranch, to: target });
    }
  }

  async function handlePublishToProduction() {
    if (!currentBranch) return;
    // From staging when on staging; otherwise promote current branch directly.
    const from =
      onStaging || !stagingExists ? currentBranch : stagingBranch;
    const outcome = await promote({ from, to: productionBranch, ffOnly: true });
    if (outcome.kind === "needs-merge-commit") {
      setForcePrompt({ from, to: productionBranch });
    }
  }

  async function handleForceMerge() {
    if (!forcePrompt) return;
    await promote({ from: forcePrompt.from, to: forcePrompt.to, ffOnly: false });
    setForcePrompt(null);
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[820px] flex-col border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <GitBranch size={12} className="text-zinc-400" />
            Git

            {/* Branch switcher */}
            <div className="relative ml-2">
              <button
                onClick={() => setBranchMenuOpen((v) => !v)}
                disabled={busy || dirty.length > 0}
                title={dirty.length > 0 ? "Commit or discard changes before switching branches" : "Switch branch"}
                className="inline-flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] normal-case text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {currentBranch || "(detached)"}
                <ChevronDown size={10} className="text-zinc-500" />
              </button>
              {branchMenuOpen && (
                <BranchMenu
                  branches={localBranches}
                  current={currentBranch}
                  productionBranch={productionBranch}
                  stagingBranch={stagingBranch}
                  stagingExists={stagingExists}
                  onClose={() => setBranchMenuOpen(false)}
                  onPick={async (name) => {
                    setBranchMenuOpen(false);
                    if (name && name !== currentBranch) await checkout(name);
                  }}
                  onCreateStaging={async () => {
                    setBranchMenuOpen(false);
                    await ensureStaging();
                  }}
                />
              )}
            </div>

            {isLocalOnly && (
              <Tooltip content="No remote configured. Push/pull/promote are disabled until a remote is added (e.g. `git remote add origin …`).">
                <span className="inline-flex items-center gap-1 text-[10px] normal-case text-amber-300">
                  <AlertCircle size={11} /> local only
                </span>
              </Tooltip>
            )}
            <Tooltip content={roleTooltip}>
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] normal-case ${
                  canUseProduction
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-zinc-900 text-zinc-500"
                }`}
              >
                <ShieldCheck size={11} />
                {roleLabel}
              </span>
            </Tooltip>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            disabled={busy}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Promote actions */}
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Promote
          </span>
          <div className="flex-1" />

          {/* Set up staging button — only when missing */}
          {!stagingExists && (
            <Tooltip
              content={
                isLocalOnly
                  ? "No remote configured"
                  : dirty.length > 0
                  ? "Commit changes before creating staging"
                  : `Create ${stagingBranch} from ${productionBranch} and push to origin`
              }
            >
              <button
                onClick={() => ensureStaging()}
                disabled={busy || isLocalOnly || dirty.length > 0}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Sparkles size={11} className="text-amber-300" />
                Set up staging
              </button>
            </Tooltip>
          )}

          {/* Send to Staging — visible when not on staging or production */}
          <Tooltip
            content={
              !currentBranch
                ? "No current branch"
                : onStaging
                ? `You're already on ${stagingBranch}`
                : onProduction
                ? `Switch to a feature branch first`
                : `Merge ${currentBranch} → ${stagingBranch}${stagingExists ? " and push" : " (creates staging first)"}`
            }
          >
            <button
              onClick={handleSendToStaging}
              title={stagingTooltip}
              disabled={busy || isLocalOnly || !currentBranch || onStaging || onProduction || dirty.length > 0}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-blue-500/40 bg-blue-500/10 px-2.5 text-[11px] font-medium text-blue-200 hover:bg-blue-500/20 hover:text-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={11} />
              Send to Staging
            </button>
          </Tooltip>

          {/* Publish to Production */}
          <Tooltip
            content={
              !currentBranch
                ? "No current branch"
                : onProduction
                ? `You're already on ${productionBranch}`
                : `Merge ${onStaging || !stagingExists ? currentBranch : stagingBranch} → ${productionBranch} and push`
            }
          >
            <button
              onClick={handlePublishToProduction}
              title={productionTooltip}
              disabled={busy || isLocalOnly || !currentBranch || onProduction || dirty.length > 0 || !canUseProduction}
              className="inline-flex h-7 items-center gap-1.5 rounded bg-emerald-500 px-2.5 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Rocket size={11} />
              Publish to Production
            </button>
          </Tooltip>
        </div>

        {/* Branch + sync row */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <ArrowUpFromLine size={11} className={ahead > 0 ? "text-emerald-300" : "text-zinc-600"} />
            {ahead} ahead
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowDownToLine size={11} className={behind > 0 ? "text-amber-300" : "text-zinc-600"} />
            {behind} behind
          </span>
          <span className="text-zinc-600">·</span>
          <span>{dirty.length} change{dirty.length === 1 ? "" : "s"}</span>
          <div className="flex-1" />
          {/* Pull (dev only) — only meaningful when behind > 0,
              which today only happens after an external git fetch.
              Hidden in marketer mode entirely. */}
          {userMode === "dev" && behind > 0 && (
            <button
              onClick={() => pull()}
              disabled={busy || isLocalOnly}
              className="inline-flex h-6 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowDownToLine size={11} />
              Pull
            </button>
          )}
          {/* Publish — single primary action: commit pending changes
              (auto-message) and push. Visible in both modes. */}
          <Tooltip content={publishTooltip}>
            <button
              onClick={handlePublish}
              disabled={!canPublish}
              className="inline-flex h-6 items-center gap-1 rounded bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <ArrowUpFromLine size={11} />
              {publishLabel}
            </button>
          </Tooltip>
        </div>

        {/* Body — two columns: changes / log */}
        <div className="grid flex-1 grid-cols-[1.4fr_1fr] gap-0 overflow-hidden">
          {/* Changes */}
          <div className="flex min-h-0 flex-col border-r border-zinc-800">
            <div className="border-b border-zinc-800 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Changes
            </div>
            <div className="flex-1 overflow-auto">
              {dirty.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">
                  Working tree clean
                </div>
              ) : (
                <ul className="py-1">
                  {dirty.map((file) => (
                    <DirtyFileRow
                      key={file.path}
                      file={file}
                      diff={diff.find((d) => d.path === file.path)}
                      expanded={expanded === file.path}
                      onToggle={() =>
                        setExpanded((prev) => (prev === file.path ? null : file.path))
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Commit input */}
            <div className="border-t border-zinc-800 p-3">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Commit message…"
                rows={2}
                disabled={busy || dirty.length === 0}
                className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-zinc-600">
                  {dirty.length === 0
                    ? "Nothing to commit"
                    : `${dirty.length} file${dirty.length === 1 ? "" : "s"} will be staged`}
                </span>
                <button
                  onClick={handleCommit}
                  disabled={busy || dirty.length === 0 || !message.trim()}
                  className="inline-flex h-7 items-center gap-1.5 rounded bg-emerald-500 px-3 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <GitCommit size={11} />}
                  Commit
                </button>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-800 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Recent commits
            </div>
            <div className="flex-1 overflow-auto">
              {commits.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">
                  No commits yet
                </div>
              ) : (
                <ul className="py-1">
                  {commits.map((c) => (
                    <li
                      key={c.hash}
                      className="px-3 py-1.5 text-[11px] hover:bg-zinc-900"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-zinc-500">
                          {c.shortHash}
                        </span>
                        <span className="truncate text-zinc-200">
                          {firstLine(c.subject)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] text-zinc-600">
                        <span>{c.author}</span>
                        <span>·</span>
                        <span>{formatDate(c.date)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {forcePrompt && (
          <ForceMergePrompt
            from={forcePrompt.from}
            to={forcePrompt.to}
            busy={busy}
            onCancel={() => setForcePrompt(null)}
            onConfirm={handleForceMerge}
          />
        )}
      </div>
    </div>
  );
}

function BranchMenu({
  branches,
  current,
  productionBranch,
  stagingBranch,
  stagingExists,
  onPick,
  onCreateStaging,
  onClose,
}: {
  branches: { name: string; current: boolean }[];
  current: string | null;
  productionBranch: string;
  stagingBranch: string;
  stagingExists: boolean;
  onPick: (name: string) => void;
  onCreateStaging: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-branch-menu]")) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const sorted = [...branches].sort((a, b) => {
    // Pin production + staging at the top, then current, then alpha
    const rank = (n: string) => {
      if (n === productionBranch) return 0;
      if (n === stagingBranch) return 1;
      if (n === current) return 2;
      return 3;
    };
    const r = rank(a.name) - rank(b.name);
    return r !== 0 ? r : a.name.localeCompare(b.name);
  });

  return (
    <div
      data-branch-menu
      className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-[320px] w-[260px] overflow-auto border border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      <div className="border-b border-zinc-800 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        Switch branch
      </div>
      <ul className="py-0.5">
        {sorted.map((b) => {
          const isProd = b.name === productionBranch;
          const isStaging = b.name === stagingBranch;
          return (
            <li key={b.name}>
              <button
                onClick={() => onPick(b.name)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-900 hover:text-white"
              >
                <span className="flex h-3 w-3 shrink-0 items-center justify-center text-emerald-400">
                  {b.current ? <Check size={11} /> : null}
                </span>
                <span className="truncate font-mono text-[11px]">{b.name}</span>
                {isProd && (
                  <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                    prod
                  </span>
                )}
                {isStaging && (
                  <span className="ml-auto rounded bg-blue-500/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-blue-300">
                    staging
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {!stagingExists && (
        <>
          <div className="border-t border-zinc-800" />
          <button
            onClick={onCreateStaging}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-amber-200 hover:bg-zinc-900"
          >
            <Sparkles size={11} className="text-amber-300" />
            Create <span className="font-mono">{stagingBranch}</span> branch
          </button>
        </>
      )}
    </div>
  );
}

function ForceMergePrompt({
  from,
  to,
  busy,
  onCancel,
  onConfirm,
}: {
  from: string;
  to: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
      <div className="w-[440px] border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-zinc-200">
          <AlertCircle size={14} className="text-amber-400" />
          Branches have diverged
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          A fast-forward merge from{" "}
          <span className="font-mono text-zinc-200">{from}</span> into{" "}
          <span className="font-mono text-zinc-200">{to}</span> isn't possible because{" "}
          <span className="font-mono text-zinc-200">{to}</span> has its own commits that aren't on{" "}
          <span className="font-mono text-zinc-200">{from}</span>.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          Create a merge commit instead? This is safe but adds a non-linear entry to the history.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-7 items-center rounded border border-zinc-800 bg-zinc-900 px-3 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1.5 rounded bg-amber-500 px-3 text-[11px] font-medium text-zinc-950 shadow-sm hover:bg-amber-400 disabled:opacity-40"
          >
            {busy && <Loader2 size={11} className="animate-spin" />}
            Force merge
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeRoleEntry(entry: string): string {
  return entry.trim().replace(/^github:/i, "").replace(/^@/, "").toLowerCase();
}

function roleMatches(entries: string[], githubLogin: string | null): boolean {
  if (!githubLogin) return false;
  const login = normalizeRoleEntry(githubLogin);
  return entries.some((entry) => {
    const normalized = normalizeRoleEntry(entry);
    return normalized === "*" || normalized === login;
  });
}

function productionAccessMessage({
  mode,
  signedIn,
  githubLogin,
  roleConfigEmpty,
  productionBranch,
}: {
  mode: "admins-only" | "any-signed-in" | "anyone";
  signedIn: boolean;
  githubLogin: string | null;
  roleConfigEmpty: boolean;
  productionBranch: string;
}): string {
  if (mode === "anyone") {
    return `Publishing to ${productionBranch} is enabled for anyone in TVE. GitHub still has final say.`;
  }
  if (mode === "any-signed-in" && !signedIn) {
    return `Sign in with GitHub to publish to ${productionBranch}.`;
  }
  if (roleConfigEmpty) {
    return `No TVE admins are configured in .tve/config.json. Add GitHub logins under roles.admins to enable production publishing for marketers.`;
  }
  return `Only TVE admins can publish to ${productionBranch}. ${githubLogin || "This user"} is not listed in roles.admins.`;
}

function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return i === -1 ? s : s.slice(0, i);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function DirtyFileRow({
  file,
  diff,
  expanded,
  onToggle,
}: {
  file: GitDirtyFile;
  diff: GitDiffEntry | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { icon, color, label } = statusVisual(file.status, file.untracked);
  return (
    <li className="border-b border-zinc-900/60 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-zinc-900"
      >
        <span className={`flex h-4 w-4 items-center justify-center ${color}`}>{icon}</span>
        <span className="truncate text-zinc-200">{file.path}</span>
        <span className="ml-auto text-[9px] uppercase tracking-wider text-zinc-600">
          {label}
        </span>
      </button>
      {expanded && diff && (
        <pre className="max-h-[280px] overflow-auto bg-black/30 px-3 py-2 font-mono text-[10px] leading-tight text-zinc-300">
          {colorizePatch(diff.patch)}
        </pre>
      )}
    </li>
  );
}

function colorizePatch(patch: string): React.ReactNode {
  if (!patch) return <span className="text-zinc-600">(no diff)</span>;
  return patch.split("\n").map((line, i) => {
    let cls = "text-zinc-400";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "text-zinc-500";
    else if (line.startsWith("@@")) cls = "text-blue-400";
    else if (line.startsWith("+")) cls = "text-emerald-300";
    else if (line.startsWith("-")) cls = "text-red-300";
    return (
      <div key={i} className={cls}>
        {line || " "}
      </div>
    );
  });
}

function statusVisual(status: string, untracked: boolean) {
  if (untracked) {
    return { icon: <Plus size={10} />, color: "text-emerald-400", label: "new" };
  }
  switch (status) {
    case "M":
      return { icon: <Pencil size={10} />, color: "text-amber-400", label: "modified" };
    case "A":
      return { icon: <Plus size={10} />, color: "text-emerald-400", label: "added" };
    case "D":
      return { icon: <Minus size={10} />, color: "text-red-400", label: "deleted" };
    case "R":
      return { icon: <FileText size={10} />, color: "text-blue-400", label: "renamed" };
    default:
      return { icon: <HelpCircle size={10} />, color: "text-zinc-500", label: status };
  }
}
