import fs from "fs/promises";
import os from "os";
import path from "path";

const FILE = path.join(os.homedir(), ".tve-recent.json");
const MAX = 10;

interface RecentFile {
  projects: string[];
}

async function read(): Promise<string[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const data = JSON.parse(raw) as RecentFile;
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

async function write(projects: string[]): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify({ projects }, null, 2), "utf-8");
}

export async function getRecentProjects(): Promise<string[]> {
  const projects = await read();
  // Filter out entries that no longer exist
  const valid: string[] = [];
  for (const p of projects) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) valid.push(p);
    } catch {
      // Skip missing paths
    }
  }
  return valid;
}

export async function addRecentProject(projectPath: string): Promise<void> {
  const existing = await read();
  const filtered = existing.filter((p) => p !== projectPath);
  filtered.unshift(projectPath);
  await write(filtered.slice(0, MAX));
}
