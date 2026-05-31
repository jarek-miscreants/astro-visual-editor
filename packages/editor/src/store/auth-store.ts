import { create } from "zustand";
import { api } from "../lib/api-client";

export interface AuthUser {
  login: string;
  id: number;
  avatarUrl: string | null;
}

interface AuthState {
  signedIn: boolean;
  user: AuthUser | null;
  installationId: number | null;
  loading: boolean;
  loaded: boolean;
  loadAuth: () => Promise<void>;
  logout: () => Promise<void>;
  /** Kicks off the OAuth flow by navigating the current tab to
   *  `/api/auth/github/start`. The server redirects to GitHub, GitHub
   *  redirects back to `/api/auth/github/callback`, and the callback
   *  handler bounces the user back here with `?signed_in=1`. */
  startSignIn: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  signedIn: false,
  user: null,
  installationId: null,
  loading: false,
  loaded: false,

  async loadAuth() {
    set({ loading: true });
    try {
      const status = await api.getAuthStatus();
      set({
        signedIn: status.signedIn,
        user: status.user ?? null,
        installationId: status.installationId ?? null,
        loaded: true,
      });
    } catch (err) {
      // Server might not be up yet, or the route might not exist on
      // an older backend. Don't crash the editor — just stay signed-out.
      console.warn("[tve] auth status load failed", err);
      set({ signedIn: false, user: null, installationId: null, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    try {
      await api.authLogout();
    } catch (err) {
      console.warn("[tve] logout failed", err);
    }
    set({ signedIn: false, user: null, installationId: null });
  },

  startSignIn() {
    // Full-tab navigation. The OAuth round-trip needs to happen at the
    // top level so GitHub can redirect to localhost without violating
    // any iframe/CSP rules.
    window.location.href = "/api/auth/github/start";
  },
}));

/** Strip the `?signed_in=1&user=...&installation_id=...` query from
 *  the URL after the OAuth callback bounces the user back. Keeps the
 *  address bar clean and prevents accidental re-trigger on reload. */
export function consumeSignedInQuery(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.has("signed_in")) {
    url.searchParams.delete("signed_in");
    url.searchParams.delete("user");
    url.searchParams.delete("installation_id");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + (url.search || "") + (url.hash || "")
    );
    return true;
  }
  return false;
}
