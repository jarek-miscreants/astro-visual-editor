import type { FileInfo } from "@tve/shared";

/** Resolve a component tag to a project-owned .astro component file. */
export function findComponentFile(
  files: FileInfo[],
  tagName: string
): FileInfo | undefined {
  const componentName = tagName.trim();
  if (!componentName) return undefined;

  return files.find((file) => {
    if (file.type !== "component") return false;
    const fileName = file.path.split("/").pop();
    return fileName === `${componentName}.astro`;
  });
}
