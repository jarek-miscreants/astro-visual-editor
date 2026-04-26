import { create } from "zustand";
import type {
  GitStatus,
  GitDiffEntry,
  GitCommitInfo,
  GitBranchInfo,
  TveBranchConfig,
} from "@tve/shared";
import { api, ApiError } from "../lib/api-client";
import { toast } from "./toast-store";

/** Result of a promote attempt that the UI can branch on for a "force merge?" prompt */
export type PromoteOutcome =
  | { kind: "ok"; method: "fast-forward" | "merge"; pushed: boolean }
  | { kind: "needs-merge-commit"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string };

interface GitState {
  status: GitStatus | null;
  branches: GitBranchInfo[];
  diff: GitDiffEntry[];
  commits: GitCommitInfo[];
  config: TveBranchConfig | null;

  /** Set while a refresh is in flight; the toolbar widget uses it for the spinner */
  loading: boolean;
  /** Set during commit/push/pull/promote so buttons can be disabled */
  busy: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  refreshDebounced: () => void;
  loadBranches: () => Promise<void>;
  loadDiff: () => Promise<void>;
  loadCommits: () => Promise<void>;
  loadConfig: () => Promise<void>;

  commit: (message: string, files?: string[]) => Promise<boolean>;
  push: () => Promise<boolean>;
  pull: () => Promise<boolean>;

  checkout: (branch: string) => Promise<boolean>;
  createBranch: (name: string, opts?: { from?: string; checkout?: boolean }) => Promise<boolean>;
  ensureStaging: () => Promise<{ name: string; created: boolean } | null>;
  promote: (opts: { from: string; to: string; ffOnly?: boolean }) => Promise<PromoteOutcome>;

  reset: () => void;
}

let refreshTimer: number | null = null;

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  branches: [],
  diff: [],
  commits: [],
  config: null,
  loading: false,
  busy: false,
  error: null,

  reset() {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    set({
      status: null,
      branches: [],
      diff: [],
      commits: [],
      config: null,
      loading: false,
      busy: false,
      error: null,
    });
  },

  async refresh() {
    set({ loading: true, error: null });
    try {
      const status = await api.getGitStatus();
      set({ status, loading: false });
    } catch (err: any) {
      // No project open is the common "expected" error path during init —
      // surface it silently as no-git so the UI hides the panel.
      const message = err?.message || "Failed to read git status";
      set({
        loading: false,
        status: {
          mode: "no-git",
          currentBranch: null,
          defaultBranch: null,
          ahead: 0,
          behind: 0,
          dirty: [],
          hasChanges: false,
          lastFetchAt: null,
        },
        error: message,
      });
    }
  },

  refreshDebounced() {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      get().refresh();
    }, 500);
  },

  async loadBranches() {
    try {
      const { branches } = await api.getGitBranches();
      set({ branches });
    } catch (err: any) {
      console.error("Failed to load branches:", err);
    }
  },

  async loadDiff() {
    try {
      const { diff } = await api.getGitDiff();
      set({ diff });
    } catch (err: any) {
      console.error("Failed to load diff:", err);
    }
  },

  async loadCommits() {
    try {
      const { commits } = await api.getGitCommits(20);
      set({ commits });
    } catch (err: any) {
      console.error("Failed to load commits:", err);
    }
  },

  async loadConfig() {
    try {
      const config = await api.getGitConfig();
      set({ config });
    } catch (err: any) {
      console.error("Failed to load git config:", err);
    }
  },

  async commit(message, files) {
    set({ busy: true, error: null });
    try {
      await api.gitCommit(message, files);
      await get().refresh();
      await get().loadCommits();
      await get().loadDiff();
      toast.success("Committed", message);
      set({ busy: false });
      return true;
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Commit failed" });
      toast.error("Commit failed", err?.message);
      return false;
    }
  },

  async push() {
    const status = get().status;
    if (!status?.currentBranch) {
      toast.error("Push failed", "No current branch");
      return false;
    }
    set({ busy: true, error: null });
    try {
      // setUpstream=true is harmless when already tracking and required when not
      await api.gitPush({ branch: status.currentBranch, setUpstream: true });
      await get().refresh();
      toast.success("Pushed", `Branch ${status.currentBranch}`);
      set({ busy: false });
      return true;
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Push failed" });
      toast.error("Push failed", err?.message);
      return false;
    }
  },

  async pull() {
    set({ busy: true, error: null });
    try {
      await api.gitPull({ mode: "ff-only" });
      await get().refresh();
      toast.success("Pulled", "Up to date with origin");
      set({ busy: false });
      return true;
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Pull failed" });
      toast.error("Pull failed", err?.message);
      return false;
    }
  },

  async checkout(branch) {
    set({ busy: true, error: null });
    try {
      await api.gitCheckout(branch);
      await get().refresh();
      await get().loadBranches();
      await get().loadDiff();
      await get().loadCommits();
      toast.success("Switched branch", branch);
      set({ busy: false });
      return true;
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Checkout failed" });
      toast.error("Couldn't switch branch", err?.message);
      return false;
    }
  },

  async createBranch(name, opts = {}) {
    set({ busy: true, error: null });
    try {
      await api.gitCreateBranch(name, opts);
      await get().refresh();
      await get().loadBranches();
      toast.success("Branch created", name);
      set({ busy: false });
      return true;
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Create branch failed" });
      toast.error("Couldn't create branch", err?.message);
      return false;
    }
  },

  async ensureStaging() {
    set({ busy: true, error: null });
    try {
      const result = await api.gitEnsureStaging();
      await get().refresh();
      await get().loadBranches();
      if (result.created) {
        toast.success(
          "Staging branch ready",
          result.pushed
            ? `Created ${result.name} and pushed to origin`
            : `Created ${result.name} (local only — no remote configured)`
        );
      }
      set({ busy: false });
      return { name: result.name, created: result.created };
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Failed to set up staging branch" });
      toast.error("Couldn't set up staging", err?.message);
      return null;
    }
  },

  async promote(opts) {
    set({ busy: true, error: null });
    try {
      const result = await api.gitPromote({
        from: opts.from,
        to: opts.to,
        ffOnly: opts.ffOnly !== false,
      });
      await get().refresh();
      await get().loadBranches();
      await get().loadCommits();
      toast.success(
        `Merged ${opts.from} → ${opts.to}`,
        result.pushed ? "Pushed to origin" : "Local only — no remote pushed"
      );
      set({ busy: false });
      return { kind: "ok", method: result.method, pushed: result.pushed };
    } catch (err: any) {
      set({ busy: false, error: err?.message || "Promotion failed" });
      if (err instanceof ApiError) {
        if (err.code === "NOT_FAST_FORWARD") {
          // Don't toast — caller will show a confirm dialog and retry with ffOnly:false
          return { kind: "needs-merge-commit", message: err.message };
        }
        if (err.code === "MERGE_CONFLICT") {
          toast.error("Merge conflict", err.message);
          return { kind: "conflict", message: err.message };
        }
      }
      toast.error("Promotion failed", err?.message);
      return { kind: "error", message: err?.message || "Promotion failed" };
    }
  },
}));
