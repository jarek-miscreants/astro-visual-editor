import fs from "fs";
import path from "path";

interface AstroCliCommand {
  cmd: string;
  args: string[];
  shell: boolean;
}

export function getAstroCliCommand(
  projectPath: string,
  args: string[]
): AstroCliCommand {
  const localAstro = path.join(projectPath, "node_modules", "astro", "bin", "astro.mjs");
  if (fs.existsSync(localAstro)) {
    return {
      cmd: process.execPath,
      args: [localAstro, ...args],
      shell: false,
    };
  }

  const isWindows = process.platform === "win32";
  return {
    cmd: isWindows ? "npx.cmd" : "npx",
    args: ["astro", ...args],
    shell: isWindows,
  };
}
