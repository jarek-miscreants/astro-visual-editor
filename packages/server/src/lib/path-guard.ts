import path from "path";

/**
 * Validate that a file path stays within the project directory.
 * Prevents directory traversal attacks (e.g., ../../etc/passwd).
 * Returns the resolved absolute path or throws.
 */
export function resolveProjectPath(
  projectPath: string,
  filePath: string
): string {
  // Normalize and resolve
  const resolved = path.resolve(projectPath, filePath);
  const normalizedProject = path.resolve(projectPath);

  // Ensure the resolved path starts with the project directory
  if (!resolved.startsWith(normalizedProject + path.sep) && resolved !== normalizedProject) {
    throw new PathTraversalError(filePath);
  }

  return resolved;
}

export class PathTraversalError extends Error {
  constructor(filePath: string) {
    super(`Path traversal blocked: ${filePath}`);
    this.name = "PathTraversalError";
  }
}
