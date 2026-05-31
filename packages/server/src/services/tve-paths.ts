import os from "os";
import path from "path";

/**
 * Resolve the TVE state directory. Defaults to `~/.tve/`. Override via
 * `TVE_HOME` env var — used by tests (point at a tmp dir) and by users
 * who want their TVE state elsewhere on disk.
 *
 * The state directory is *not* the same as the repos cache base. Repos
 * live at `tveReposBaseDir()` by default but are user-relocatable via
 * `prefs.repos_base_dir`; the state directory always stays here.
 */
export function tveHome(): string {
  return process.env.TVE_HOME || path.join(os.homedir(), ".tve");
}

export function tveStateDbPath(): string {
  return path.join(tveHome(), "state.db");
}

export function tveReposBaseDir(): string {
  return path.join(tveHome(), "repos");
}
