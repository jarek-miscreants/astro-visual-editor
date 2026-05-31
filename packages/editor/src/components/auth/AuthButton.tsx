import { useState, useRef, useEffect } from "react";
import { Github, LogOut, ChevronDown, Loader2, FolderGit2 } from "lucide-react";
import { useAuthStore } from "../../store/auth-store";
import { useEditorStore } from "../../store/editor-store";
import { Tooltip } from "../ui/Tooltip";
import { GitHubRepoPickerDialog } from "../dialogs/GitHubRepoPickerDialog";

/**
 * Minimal sign-in widget for the toolbar. Three states:
 *
 *   - loading       → tiny spinner
 *   - signed-out    → "Sign in" button, opens the OAuth flow on click
 *   - signed-in     → avatar + login, click opens a dropdown with Sign out
 */
export function AuthButton() {
  const loading = useAuthStore((s) => s.loading);
  const loaded = useAuthStore((s) => s.loaded);
  const signedIn = useAuthStore((s) => s.signedIn);
  const user = useAuthStore((s) => s.user);
  const startSignIn = useAuthStore((s) => s.startSignIn);
  const logout = useAuthStore((s) => s.logout);

  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const resetProject = useEditorStore((s) => s.resetProject);
  const initProject = useEditorStore((s) => s.initProject);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!loaded || loading) {
    return (
      <span className="tve-status tve-status--starting" style={{ minWidth: 0 }}>
        <Loader2 size={11} className="animate-spin" />
      </span>
    );
  }

  if (!signedIn) {
    return (
      <Tooltip content="Sign in with your GitHub account">
        <button onClick={startSignIn} className="tve-button-secondary">
          <Github size={11} />
          Sign in
        </button>
      </Tooltip>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="tve-button-secondary"
        title={user ? `Signed in as @${user.login}` : "Signed in"}
      >
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            width={14}
            height={14}
            style={{ borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <Github size={11} />
        )}
        {user?.login ?? "GitHub"}
        <ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "var(--tve-bg-popover, #18181b)",
            border: "1px solid var(--tve-border, #27272a)",
            borderRadius: 4,
            padding: "4px 0",
            minWidth: 200,
            zIndex: 50,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <button
            onClick={() => {
              setOpen(false);
              setShowPicker(true);
            }}
            className="tve-button-secondary"
            style={{
              width: "100%",
              justifyContent: "flex-start",
              border: "none",
              borderRadius: 0,
              background: "transparent",
            }}
          >
            <FolderGit2 size={11} />
            Open repo from GitHub…
          </button>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="tve-button-secondary"
            style={{
              width: "100%",
              justifyContent: "flex-start",
              border: "none",
              borderRadius: 0,
              background: "transparent",
            }}
          >
            <LogOut size={11} />
            Sign out
          </button>
        </div>
      )}
      {showPicker && (
        <GitHubRepoPickerDialog
          onClose={() => setShowPicker(false)}
          onSwitched={async () => {
            setShowPicker(false);
            resetProject();
            await initProject();
          }}
        />
      )}
    </div>
  );
}
