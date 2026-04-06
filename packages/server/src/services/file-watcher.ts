import { watch } from "chokidar";
import path from "path";
import { parseAstroFileAsync } from "./astro-parser.js";

export function setupFileWatcher(
  projectPath: string,
  broadcast: (message: object) => void
) {
  const watcher = watch("**/*.astro", {
    cwd: projectPath,
    ignoreInitial: true,
    ignored: ["node_modules/**", "dist/**", ".astro/**"],
  });

  // Debounce per-file to avoid rapid re-parsing during save
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  watcher.on("change", (relativePath) => {
    const existing = debounceTimers.get(relativePath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      relativePath,
      setTimeout(async () => {
        debounceTimers.delete(relativePath);
        try {
          const fullPath = path.join(projectPath, relativePath);
          const { ast } = await parseAstroFileAsync(fullPath);
          broadcast({
            type: "file:changed",
            path: relativePath.replace(/\\/g, "/"),
            ast,
          });
          console.log(`[Watcher] File changed: ${relativePath}`);
        } catch (err) {
          console.error(`[Watcher] Error parsing ${relativePath}:`, err);
        }
      }, 200)
    );
  });

  console.log("[Watcher] Watching for .astro file changes");
  return watcher;
}
