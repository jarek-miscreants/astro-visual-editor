import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import type { ComponentPropField, ComponentPropSchema } from "@tve/shared";

interface CacheEntry {
  mtime: number;
  schema: ComponentPropSchema;
}

const cache = new Map<string, CacheEntry>();

/**
 * Parse a component's Props interface from its Astro frontmatter and return
 * a typed schema. Falls back to an empty schema (fields: []) if no Props
 * interface is found or the frontmatter can't be parsed.
 */
export async function getComponentPropSchema(
  projectPath: string,
  relPath: string
): Promise<ComponentPropSchema> {
  const full = path.join(projectPath, relPath);
  const stat = await fs.stat(full);
  const cached = cache.get(full);
  if (cached && cached.mtime === stat.mtimeMs) return cached.schema;

  const source = await fs.readFile(full, "utf-8");
  const frontmatter = extractFrontmatter(source);
  const fields = frontmatter ? parseProps(frontmatter, frontmatter) : [];
  const schema: ComponentPropSchema = { componentPath: relPath, fields };

  cache.set(full, { mtime: stat.mtimeMs, schema });
  return schema;
}

/** Extract the content between the first pair of `---` fences in an .astro file.
 *  Astro accepts an indented closing fence (e.g. `  ---`), so the trailing
 *  match allows leading spaces/tabs. Without this tolerance, components whose
 *  authors indented the frontmatter block (common style) silently parse as
 *  having no Props, so the editor's CONTENT panel never shows fields. */
function extractFrontmatter(source: string): string | null {
  const match = source.match(/^---\s*\n([\s\S]*?)\n[ \t]*---/);
  return match ? match[1] : null;
}

/**
 * Parse Props via TypeScript compiler API. Supports:
 *  - `interface Props { ... }`
 *  - `type Props = { ... }`
 *  - Optional markers (`?`)
 *  - String literal unions → enum
 *  - Numeric literal unions (`1 | 2 | 3 | 4`) → number-enum, including
 *    indirected unions like `type Cols = 1|...|12; mobile?: Cols`.
 *  - `boolean`, `string`, `number` primitives
 *  - Default values from `const { foo = "bar" } = Astro.props`
 *  - Leading JSDoc comments — surfaced as `field.jsdoc` for editor tooltips
 */
function parseProps(frontmatter: string, source: string): ComponentPropField[] {
  const sourceFile = ts.createSourceFile(
    "frontmatter.ts",
    frontmatter,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const members = findPropsMembers(sourceFile);
  if (!members) return [];

  const defaults = findDefaults(sourceFile);
  const typeAliases = collectTypeAliases(sourceFile);
  const fields: ComponentPropField[] = [];

  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const nameNode = member.name;
    if (!ts.isIdentifier(nameNode) && !ts.isStringLiteral(nameNode)) continue;
    const name = nameNode.text;
    // Skip `class` / `className` — handled by the class editor
    if (name === "class" || name === "className") continue;
    const required = !member.questionToken;
    const jsdoc = readJsDoc(member, source);
    const field = classifyType(
      name,
      required,
      member.type,
      defaults[name],
      typeAliases,
      jsdoc
    );
    if (field) fields.push(field);
  }

  return fields;
}

/** Extract leading JSDoc text above a property signature. We strip the
 *  `/**` framing and `*` line prefixes so the result reads as plain prose
 *  for tooltip use. Empty or missing comments → undefined. */
function readJsDoc(member: ts.PropertySignature, source: string): string | undefined {
  const fullStart = member.getFullStart();
  const start = member.getStart(undefined, false);
  if (start <= fullStart) return undefined;
  const leading = source.slice(fullStart, start);
  // Match the LAST jsdoc-style block before the member — `/** ... */`. Some
  // signatures have line comments mixed in; we want only the structured one.
  const matches = [...leading.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  if (matches.length === 0) return undefined;
  const raw = matches[matches.length - 1][1];
  const cleaned = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Build a name → TypeNode map for `type X = ...` aliases declared in the
 *  frontmatter. Lets us resolve indirected unions like `mobile?: Cols`. */
function collectTypeAliases(sf: ts.SourceFile): Map<string, ts.TypeNode> {
  const out = new Map<string, ts.TypeNode>();
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text !== "Props") {
      out.set(stmt.name.text, stmt.type);
    }
  }
  return out;
}

function findPropsMembers(sf: ts.SourceFile): ts.NodeArray<ts.TypeElement> | null {
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === "Props") {
      return stmt.members;
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === "Props") {
      if (ts.isTypeLiteralNode(stmt.type)) return stmt.type.members;
    }
  }
  return null;
}

/** Parse `const { foo = "bar", baz = 3 } = Astro.props;` for default values. */
function findDefaults(sf: ts.SourceFile): Record<string, ts.Expression> {
  const out: Record<string, ts.Expression> = {};
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isObjectBindingPattern(decl.name)) continue;
      // Only consume destructures of `Astro.props`
      if (!decl.initializer) continue;
      const init = decl.initializer;
      const isAstroProps =
        ts.isPropertyAccessExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "Astro" &&
        init.name.text === "props";
      if (!isAstroProps) continue;
      for (const el of decl.name.elements) {
        if (!ts.isBindingElement(el)) continue;
        if (el.initializer && ts.isIdentifier(el.name)) {
          out[el.name.text] = el.initializer;
        }
      }
    }
  }
  return out;
}

function classifyType(
  name: string,
  required: boolean,
  typeNode: ts.TypeNode | undefined,
  defaultExpr: ts.Expression | undefined,
  typeAliases: Map<string, ts.TypeNode>,
  jsdoc: string | undefined
): ComponentPropField | null {
  if (!typeNode) return null;

  // Strip a trailing `| undefined` if present, then resolve through any
  // `type X = ...` alias (e.g. `mobile?: Cols` where `Cols = 1|...|12`).
  const effectiveType = resolveAlias(unwrapOptional(typeNode), typeAliases);

  // Numeric literal union → number-enum (e.g. `Cols = 1 | 2 | ... | 12`)
  const numEnumOptions = extractNumericLiteralUnion(effectiveType);
  if (numEnumOptions) {
    return {
      kind: "number-enum",
      name,
      required,
      options: numEnumOptions,
      default: readNumberDefault(defaultExpr),
      jsdoc,
    };
  }

  // String literal union → enum
  const enumOptions = extractStringLiteralUnion(effectiveType);
  if (enumOptions) {
    return {
      kind: "enum",
      name,
      required,
      options: enumOptions,
      default: readStringDefault(defaultExpr),
      jsdoc,
    };
  }

  // Primitives
  if (effectiveType.kind === ts.SyntaxKind.BooleanKeyword) {
    return {
      kind: "boolean",
      name,
      required,
      default: readBooleanDefault(defaultExpr),
      jsdoc,
    };
  }
  if (effectiveType.kind === ts.SyntaxKind.StringKeyword) {
    return {
      kind: "string",
      name,
      required,
      default: readStringDefault(defaultExpr),
      jsdoc,
    };
  }
  if (effectiveType.kind === ts.SyntaxKind.NumberKeyword) {
    return {
      kind: "number",
      name,
      required,
      default: readNumberDefault(defaultExpr),
      jsdoc,
    };
  }

  // Single string literal → treat as enum with one option
  if (ts.isLiteralTypeNode(effectiveType) && ts.isStringLiteral(effectiveType.literal)) {
    return {
      kind: "enum",
      name,
      required,
      options: [effectiveType.literal.text],
      default: readStringDefault(defaultExpr),
      jsdoc,
    };
  }

  return {
    kind: "unknown",
    name,
    required,
    typeText: effectiveType.getText?.() ?? "",
    jsdoc,
  };
}

/** Follow a `type X = Y` alias one hop. We deliberately don't recurse — that
 *  would let us resolve `type A = B; type B = C` chains, but it also opens
 *  the door to cycles. One hop covers the common case (`type Cols = 1|...|12;
 *  mobile?: Cols`) without that risk. */
function resolveAlias(
  node: ts.TypeNode,
  aliases: Map<string, ts.TypeNode>
): ts.TypeNode {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const target = aliases.get(node.typeName.text);
    if (target) return target;
  }
  return node;
}

function extractNumericLiteralUnion(node: ts.TypeNode): number[] | null {
  // A single numeric literal type is a degenerate "union" with one option.
  if (
    ts.isLiteralTypeNode(node) &&
    ts.isNumericLiteral(node.literal)
  ) {
    return [Number(node.literal.text)];
  }
  if (!ts.isUnionTypeNode(node)) return null;
  const values: number[] = [];
  for (const t of node.types) {
    if (!ts.isLiteralTypeNode(t)) return null;
    if (!ts.isNumericLiteral(t.literal)) return null;
    values.push(Number(t.literal.text));
  }
  return values.length > 0 ? values : null;
}

function unwrapOptional(node: ts.TypeNode): ts.TypeNode {
  if (ts.isUnionTypeNode(node)) {
    const nonUndefined = node.types.filter(
      (t) => t.kind !== ts.SyntaxKind.UndefinedKeyword
    );
    if (nonUndefined.length === 1) return nonUndefined[0];
    if (nonUndefined.length < node.types.length) {
      return ts.factory.createUnionTypeNode(nonUndefined);
    }
  }
  return node;
}

function extractStringLiteralUnion(node: ts.TypeNode): string[] | null {
  if (!ts.isUnionTypeNode(node)) return null;
  const values: string[] = [];
  for (const t of node.types) {
    if (!ts.isLiteralTypeNode(t)) return null;
    if (!ts.isStringLiteral(t.literal)) return null;
    values.push(t.literal.text);
  }
  return values.length > 0 ? values : null;
}

function readStringDefault(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  return undefined;
}

function readBooleanDefault(expr: ts.Expression | undefined): boolean | undefined {
  if (!expr) return undefined;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function readNumberDefault(expr: ts.Expression | undefined): number | undefined {
  if (!expr) return undefined;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  return undefined;
}
