import fs from "fs/promises";
import path from "path";
import type {
  ComponentRegistryEntry,
  ComponentRegistryItem,
  ComponentRegistrySource,
} from "@tve/shared";
import { scanProject } from "./project-scanner.js";
import { getComponentPropSchema } from "./component-props.js";
import { getComponentSlots } from "./component-slots.js";

function companionSchemaPath(projectPath: string, componentPath: string): string {
  return path.join(projectPath, componentPath).replace(/\.astro$/i, ".tve.ts");
}

async function hasCompanionSchema(projectPath: string, componentPath: string): Promise<boolean> {
  try {
    await fs.access(companionSchemaPath(projectPath, componentPath));
    return true;
  } catch {
    return false;
  }
}

function componentName(componentPath: string): string {
  return path.basename(componentPath, ".astro");
}

function registrySource(hasSchema: boolean, fieldCount: number): ComponentRegistrySource {
  if (hasSchema) return "tve-schema";
  if (fieldCount > 0) return "props";
  return "empty";
}

function toItem(entry: ComponentRegistryEntry): ComponentRegistryItem {
  const {
    props: _props,
    slots: _slots,
    defaultProps: _defaultProps,
    defaultChildren: _defaultChildren,
    ...item
  } = entry;
  return item;
}

export async function getComponentRegistryEntry(
  projectPath: string,
  componentPath: string
): Promise<ComponentRegistryEntry> {
  const [props, slots, hasSchema] = await Promise.all([
    getComponentPropSchema(projectPath, componentPath),
    getComponentSlots(projectPath, componentPath),
    hasCompanionSchema(projectPath, componentPath),
  ]);

  const name = componentName(componentPath);
  const meta = props.meta ?? {};
  const warnings = props.warnings ?? [];
  const fieldCount = props.fields.length;
  const slotCount = slots.slots.length;

  return {
    componentPath,
    name,
    tagName: name,
    label: meta.label ?? name,
    category: meta.category ?? "Components",
    description: meta.description,
    thumbnail: meta.thumbnail,
    insertable: meta.insertable ?? false,
    source: registrySource(hasSchema, fieldCount),
    fieldCount,
    slotCount,
    warnings,
    props,
    slots,
    defaultProps: meta.defaultProps,
    defaultChildren: meta.defaultChildren,
  };
}

export async function listComponentRegistry(projectPath: string): Promise<ComponentRegistryItem[]> {
  const files = await scanProject(projectPath);
  const componentFiles = files.filter((file) => file.type === "component");
  const entries = await Promise.all(
    componentFiles.map((file) => getComponentRegistryEntry(projectPath, file.path))
  );

  return entries
    .map(toItem)
    .sort((a, b) => {
      const byCategory = a.category.localeCompare(b.category);
      if (byCategory !== 0) return byCategory;
      return a.label.localeCompare(b.label);
    });
}
