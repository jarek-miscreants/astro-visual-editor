import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import MagicString from "magic-string";
import type {
  RepeaterArray,
  LoopBinding,
  ComponentDataResult,
  RepeaterFieldType,
} from "@tve/shared";
import { renderFieldBinding } from "./repeater-generator.js";

export type { RepeaterArray, LoopBinding, ComponentDataResult };

/**
 * Reads and writes "list content" defined as a top-level `const X = [ {…}, … ]`
 * array of object literals in an .astro component's frontmatter — the data
 * behind a `{X.map((item) => …)}` loop.
 *
 * This is the server half of the repeater panel (Route 2). Inline editing of
 * loop-rendered text is refused (see the update-text guard), because N rendered
 * elements share one source node and the data lives in `X[i].field`. Here we
 * surface that array as structured rows and rewrite individual field literals
 * surgically with magic-string, leaving formatting and the rest of the file
 * byte-for-byte intact.
 *
 * Scope: string / number / boolean literal fields only. Computed values,
 * nested objects/arrays, and spreads are reported but not editable.
 */

export type RepeaterFieldKind = "string" | "number" | "boolean";

/** Locate the frontmatter block and its start offset within the source. */
function frontmatterRange(
  source: string
): { content: string; start: number } | null {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n[ \t]*---/);
  if (!match) return null;
  // The captured group (index 1) begins right after the opening fence + newline.
  const start = match.index! + match[0].indexOf(match[1]);
  return { content: match[1], start };
}

function literalKindAndValue(
  expr: ts.Expression
): { kind: RepeaterFieldKind; value: string | number | boolean } | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { kind: "string", value: expr.text };
  }
  if (ts.isNumericLiteral(expr)) {
    return { kind: "number", value: Number(expr.text) };
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { kind: "boolean", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: false };
  // Negative numbers parse as a prefix unary expression.
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return { kind: "number", value: -Number(expr.operand.text) };
  }
  return null;
}

function propKey(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

/** Find top-level `const X = [ {…}, … ]` declarations of object literals. */
function findArrayDeclarations(
  sf: ts.SourceFile
): { name: string; array: ts.ArrayLiteralExpression }[] {
  const out: { name: string; array: ts.ArrayLiteralExpression }[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      if (!ts.isArrayLiteralExpression(decl.initializer)) continue;
      const elements = decl.initializer.elements;
      if (elements.length === 0) continue;
      // Only arrays whose elements are all object literals — that's the
      // repeater shape. Mixed/primitive arrays aren't list content.
      if (!elements.every((el) => ts.isObjectLiteralExpression(el))) continue;
      out.push({ name: decl.name.text, array: decl.initializer });
    }
  }
  return out;
}

/** Parse `arrayName.map((itemVar) => …)` occurrences from the markup. */
function findLoopBindings(source: string): LoopBinding[] {
  const out: LoopBinding[] = [];
  const seen = new Set<string>();
  const re = /\b([A-Za-z_$][\w$]*)\s*\.\s*map\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const key = `${m[1]}::${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ arrayName: m[1], itemVar: m[2] });
  }
  return out;
}

export async function readComponentArrays(
  projectPath: string,
  relPath: string
): Promise<ComponentDataResult> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  const fm = frontmatterRange(source);
  if (!fm) {
    return { componentPath: relPath, arrays: [], loopBindings: [] };
  }

  const sf = ts.createSourceFile(
    "frontmatter.ts",
    fm.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const arrays: RepeaterArray[] = [];
  for (const { name, array } of findArrayDeclarations(sf)) {
    const fields: string[] = [];
    const items: Record<string, string | number | boolean>[] = [];
    for (const el of array.elements) {
      if (!ts.isObjectLiteralExpression(el)) {
        items.push({});
        continue;
      }
      const item: Record<string, string | number | boolean> = {};
      for (const prop of el.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = propKey(prop.name);
        if (!key) continue;
        const lit = literalKindAndValue(prop.initializer);
        if (!lit) continue; // non-literal field — skip (stays read-only)
        if (!fields.includes(key)) fields.push(key);
        item[key] = lit.value;
      }
      items.push(item);
    }
    arrays.push({ name, fields, items, count: array.elements.length });
  }

  return {
    componentPath: relPath,
    arrays,
    loopBindings: findLoopBindings(source),
  };
}

export interface WriteComponentArrayInput {
  arrayName: string;
  index: number;
  field: string;
  value: string | number | boolean;
}

export interface WriteComponentArrayResult {
  success: boolean;
  error?: string;
}

export async function writeComponentArrayField(
  projectPath: string,
  relPath: string,
  input: WriteComponentArrayInput
): Promise<WriteComponentArrayResult> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  const fm = frontmatterRange(source);
  if (!fm) return { success: false, error: "No frontmatter block found." };

  const sf = ts.createSourceFile(
    "frontmatter.ts",
    fm.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const decl = findArrayDeclarations(sf).find((d) => d.name === input.arrayName);
  if (!decl) {
    return { success: false, error: `Array \`${input.arrayName}\` not found in frontmatter.` };
  }
  const element = decl.array.elements[input.index];
  if (!element || !ts.isObjectLiteralExpression(element)) {
    return { success: false, error: `Item ${input.index} not found in \`${input.arrayName}\`.` };
  }

  // Find the existing literal property to overwrite. (Adding new keys is out of
  // scope — we only edit values that already exist in the source.)
  let target: ts.PropertyAssignment | null = null;
  for (const prop of element.properties) {
    if (ts.isPropertyAssignment(prop) && propKey(prop.name) === input.field) {
      target = prop;
      break;
    }
  }
  if (!target) {
    return {
      success: false,
      error: `Field \`${input.field}\` not found on item ${input.index}.`,
    };
  }

  const existing = literalKindAndValue(target.initializer);
  if (!existing) {
    return {
      success: false,
      error: `Field \`${input.field}\` is not a plain literal and can't be edited here.`,
    };
  }

  // Render the replacement literal. JSON.stringify gives safe double-quoted
  // escaping for strings; numbers/booleans render verbatim. We coerce the
  // incoming value to the field's existing kind so a text input can't turn a
  // numeric field into a string.
  let replacement: string;
  if (existing.kind === "string") {
    replacement = JSON.stringify(String(input.value));
  } else if (existing.kind === "number") {
    const n = Number(input.value);
    if (!Number.isFinite(n)) {
      return { success: false, error: `\`${input.field}\` must be a number.` };
    }
    replacement = String(n);
  } else {
    replacement = String(input.value === true || input.value === "true");
  }

  const startInFile = fm.start + target.initializer.getStart(sf);
  const endInFile = fm.start + target.initializer.getEnd();

  const s = new MagicString(source);
  s.overwrite(startInFile, endInFile, replacement);
  await fs.writeFile(full, s.toString(), "utf-8");

  return { success: true };
}

/** Indentation (leading whitespace) of the line containing `offset`. */
function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return text.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? "";
}

/** The empty literal for a field kind: "", 0, false. */
function emptyLiteralFor(kind: RepeaterFieldKind): string {
  if (kind === "number") return "0";
  if (kind === "boolean") return "false";
  return '""';
}

/**
 * Append a new, empty array item. Fields and their kinds are inferred from the
 * existing items (string→"", number→0, boolean→false) so the new object matches
 * the array's shape but carries no content — the user fills it in deliberately,
 * avoiding the "cloned card silently shipped" mistake. Formatting (indentation,
 * one-prop-per-line) mirrors the last existing item.
 */
export async function addComponentArrayItem(
  projectPath: string,
  relPath: string,
  arrayName: string
): Promise<WriteComponentArrayResult> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  const fm = frontmatterRange(source);
  if (!fm) return { success: false, error: "No frontmatter block found." };

  const sf = ts.createSourceFile(
    "frontmatter.ts",
    fm.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const decl = findArrayDeclarations(sf).find((d) => d.name === arrayName);
  if (!decl) {
    return { success: false, error: `Array \`${arrayName}\` not found in frontmatter.` };
  }
  const elements = decl.array.elements;
  const last = elements[elements.length - 1];
  if (!last || !ts.isObjectLiteralExpression(last)) {
    return { success: false, error: `Can't infer item shape for \`${arrayName}\`.` };
  }

  // Collect fields + kinds in source order from the last item (its literal
  // properties define the shape we mirror).
  const shape: { field: string; kind: RepeaterFieldKind }[] = [];
  for (const prop of last.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propKey(prop.name);
    if (!key) continue;
    const lit = literalKindAndValue(prop.initializer);
    if (!lit) continue;
    shape.push({ field: key, kind: lit.kind });
  }
  if (shape.length === 0) {
    return { success: false, error: `\`${arrayName}\` items have no editable fields.` };
  }

  // Mirror the existing indentation: the element's own indent, and its first
  // property's indent.
  const elementIndent = lineIndentAt(fm.content, last.getStart(sf));
  const firstProp = last.properties[0];
  const propIndent = firstProp
    ? lineIndentAt(fm.content, firstProp.getStart(sf))
    : elementIndent + "  ";

  const body = shape
    .map(({ field, kind }) => `${propIndent}${field}: ${emptyLiteralFor(kind)},`)
    .join("\n");
  const newItem = `{\n${body}\n${elementIndent}}`;

  // Insert just after the last element's closing brace. This lands between the
  // `}` and any trailing comma, producing valid syntax whether or not the array
  // already had a trailing comma.
  const insertAt = fm.start + last.getEnd();
  const s = new MagicString(source);
  s.appendLeft(insertAt, `,\n${elementIndent}${newItem}`);
  await fs.writeFile(full, s.toString(), "utf-8");

  return { success: true };
}

/** Remove an array item (and its trailing comma + line) by index. */
export async function removeComponentArrayItem(
  projectPath: string,
  relPath: string,
  arrayName: string,
  index: number
): Promise<WriteComponentArrayResult> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  const fm = frontmatterRange(source);
  if (!fm) return { success: false, error: "No frontmatter block found." };

  const sf = ts.createSourceFile(
    "frontmatter.ts",
    fm.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const decl = findArrayDeclarations(sf).find((d) => d.name === arrayName);
  if (!decl) {
    return { success: false, error: `Array \`${arrayName}\` not found in frontmatter.` };
  }
  const element = decl.array.elements[index];
  if (!element) {
    return { success: false, error: `Item ${index} not found in \`${arrayName}\`.` };
  }

  // Remove from the start of the element's line (drop its indentation) through
  // the trailing comma and the newline, so no blank line is left behind.
  const startInContent = element.getStart(sf);
  const lineStart = fm.content.lastIndexOf("\n", startInContent - 1) + 1;
  let endInContent = element.getEnd();
  // Swallow a trailing comma.
  while (endInContent < fm.content.length && /[ \t]/.test(fm.content[endInContent])) {
    endInContent++;
  }
  if (fm.content[endInContent] === ",") endInContent++;
  // Swallow the rest of the line including its newline.
  while (endInContent < fm.content.length && fm.content[endInContent] !== "\n") {
    endInContent++;
  }
  if (fm.content[endInContent] === "\n") endInContent++;

  const s = new MagicString(source);
  s.remove(fm.start + lineStart, fm.start + endInContent);
  await fs.writeFile(full, s.toString(), "utf-8");

  return { success: true };
}

/**
 * Reorder an array item by swapping it with its neighbour. Swapping two
 * adjacent elements' source slices (rather than rewriting the array) keeps the
 * separators — commas, newlines, indentation — in place, so each item's exact
 * formatting is preserved.
 */
export async function moveComponentArrayItem(
  projectPath: string,
  relPath: string,
  arrayName: string,
  index: number,
  dir: "up" | "down"
): Promise<WriteComponentArrayResult> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  const fm = frontmatterRange(source);
  if (!fm) return { success: false, error: "No frontmatter block found." };

  const sf = ts.createSourceFile(
    "frontmatter.ts",
    fm.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const decl = findArrayDeclarations(sf).find((d) => d.name === arrayName);
  if (!decl) {
    return { success: false, error: `Array \`${arrayName}\` not found in frontmatter.` };
  }
  const elements = decl.array.elements;
  if (!elements[index]) {
    return { success: false, error: `Item ${index} not found in \`${arrayName}\`.` };
  }
  const neighbour = dir === "up" ? index - 1 : index + 1;
  if (neighbour < 0 || neighbour >= elements.length) {
    return { success: false, error: `Can't move item ${index} ${dir}.` };
  }

  const a = elements[Math.min(index, neighbour)];
  const b = elements[Math.max(index, neighbour)];
  const aStart = fm.start + a.getStart(sf);
  const aEnd = fm.start + a.getEnd();
  const bStart = fm.start + b.getStart(sf);
  const bEnd = fm.start + b.getEnd();
  const aText = source.slice(aStart, aEnd);
  const bText = source.slice(bStart, bEnd);

  // Swap the two (disjoint) element bodies; the text between them is untouched.
  const s = new MagicString(source);
  s.overwrite(aStart, aEnd, bText);
  s.overwrite(bStart, bEnd, aText);
  await fs.writeFile(full, s.toString(), "utf-8");

  return { success: true };
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** Locate the `{arrayName.map((itemVar) => …)}` call in the markup: the offset
 *  range of the callback args `(…)` (so template edits stay scoped to THIS
 *  loop, not another repeater that happens to share the item variable). */
function findMapRegion(
  source: string,
  arrayName: string
): { itemVar: string; open: number; close: number } | null {
  const re = new RegExp(
    `\\b${arrayName}\\s*\\.\\s*map\\s*\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)`
  );
  const m = re.exec(source);
  if (!m) return null;
  const itemVar = m[1];
  // The '(' that opens map(...) — first '(' at/after the matched `.map`.
  const mapWord = source.indexOf("map", m.index);
  const open = source.indexOf("(", mapWord);
  if (open === -1) return null;
  // Paren-match to the closing ')' of the map call.
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { itemVar, open, close: i };
    }
  }
  return null;
}

/** The empty seed literal for a field type. */
function emptyFieldLiteral(type: RepeaterFieldType): string {
  if (type === "boolean") return "false";
  if (type === "number") return "0";
  return '""';
}

/** Indentation of the line containing `offset`, within frontmatter content. */
function lineIndentInFm(content: string, offset: number): string {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  return content.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? "";
}

interface FieldOpContext {
  full: string;
  source: string;
  fm: { content: string; start: number };
  sf: ts.SourceFile;
  array: ts.ArrayLiteralExpression;
}

/** Shared setup for the field ops: read + parse + locate the array. */
async function fieldOpContext(
  projectPath: string,
  relPath: string,
  arrayName: string
): Promise<FieldOpContext | { error: string }> {
  const full = path.join(projectPath, relPath);
  const source = await fs.readFile(full, "utf-8");
  const fm = frontmatterRange(source);
  if (!fm) return { error: "No frontmatter block found." };
  const sf = ts.createSourceFile(
    "frontmatter.ts",
    fm.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const decl = findArrayDeclarations(sf).find((d) => d.name === arrayName);
  if (!decl) return { error: `Array \`${arrayName}\` not found in frontmatter.` };
  return { full, source, fm, sf, array: decl.array };
}

function objectLiterals(array: ts.ArrayLiteralExpression): ts.ObjectLiteralExpression[] {
  return array.elements.filter((e): e is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(e)
  );
}

function findProp(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.PropertyAssignment | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propKey(p.name) === name) return p;
  }
  return null;
}

/** Add a field: append `name: <empty>` to every item object, and a binding to
 *  the card template so the new field renders. */
export async function addArrayField(
  projectPath: string,
  relPath: string,
  arrayName: string,
  fieldName: string,
  fieldType: RepeaterFieldType
): Promise<WriteComponentArrayResult> {
  if (!IDENT_RE.test(fieldName)) {
    return { success: false, error: `"${fieldName}" is not a valid field name.` };
  }
  const ctx = await fieldOpContext(projectPath, relPath, arrayName);
  if ("error" in ctx) return { success: false, error: ctx.error };
  const { full, source, fm, array } = ctx;

  const objs = objectLiterals(array);
  if (objs.some((o) => findProp(o, fieldName))) {
    return { success: false, error: `Field \`${fieldName}\` already exists.` };
  }

  const s = new MagicString(source);
  const literal = emptyFieldLiteral(fieldType);
  for (const obj of objs) {
    const props = obj.properties;
    if (props.length === 0) {
      // Empty object: insert just inside the braces.
      const indent = lineIndentInFm(fm.content, obj.getStart(ctx.sf)) + "  ";
      s.appendLeft(
        fm.start + obj.getStart(ctx.sf) + 1,
        `\n${indent}${fieldName}: ${literal},`
      );
      continue;
    }
    const last = props[props.length - 1];
    const indent = lineIndentInFm(fm.content, last.getStart(ctx.sf));
    // Insert AFTER the last property — and after its trailing comma if it has
    // one — so we never produce `value,,` or a missing separator.
    let cursor = last.getEnd();
    while (cursor < fm.content.length && /[ \t]/.test(fm.content[cursor])) cursor++;
    if (fm.content[cursor] === ",") {
      // Trailing comma present: insert after it, with our own trailing comma.
      s.appendLeft(fm.start + cursor + 1, `\n${indent}${fieldName}: ${literal},`);
    } else {
      // No trailing comma: add one to the previous prop, then our prop.
      s.appendLeft(fm.start + last.getEnd(), `,\n${indent}${fieldName}: ${literal},`);
    }
  }

  // Template: insert a binding before the card's closing tag (the last `</…>`
  // inside the map callback, which is the loop root element's close).
  const region = findMapRegion(source, arrayName);
  if (region) {
    const closeIdx = source.lastIndexOf("</", region.close);
    if (closeIdx > region.open) {
      const tagLineStart = source.lastIndexOf("\n", closeIdx - 1) + 1;
      const indent = source.slice(tagLineStart, closeIdx).match(/^[ \t]*/)?.[0] ?? "        ";
      const binding = renderFieldBinding({ name: fieldName, type: fieldType }, region.itemVar);
      s.appendLeft(closeIdx, `${binding}\n${indent}`);
    }
  }

  await fs.writeFile(full, s.toString(), "utf-8");
  return { success: true };
}

/** Rename a field across every item object and its `{itemVar.field}` bindings. */
export async function renameArrayField(
  projectPath: string,
  relPath: string,
  arrayName: string,
  from: string,
  to: string
): Promise<WriteComponentArrayResult> {
  if (!IDENT_RE.test(to)) {
    return { success: false, error: `"${to}" is not a valid field name.` };
  }
  if (from === to) return { success: true };
  const ctx = await fieldOpContext(projectPath, relPath, arrayName);
  if ("error" in ctx) return { success: false, error: ctx.error };
  const { full, source, fm, sf, array } = ctx;

  const objs = objectLiterals(array);
  if (objs.some((o) => findProp(o, to))) {
    return { success: false, error: `Field \`${to}\` already exists.` };
  }

  const s = new MagicString(source);
  // Data: rename the property key on every item that has it.
  let renamedAny = false;
  for (const obj of objs) {
    const prop = findProp(obj, from);
    if (!prop) continue;
    renamedAny = true;
    const nameStart = fm.start + prop.name.getStart(sf);
    const nameEnd = fm.start + prop.name.getEnd();
    s.overwrite(nameStart, nameEnd, to);
  }
  if (!renamedAny) {
    return { success: false, error: `Field \`${from}\` not found.` };
  }

  // Template: replace `itemVar.from` with `itemVar.to`, scoped to this map call.
  const region = findMapRegion(source, arrayName);
  if (region) {
    const body = source.slice(region.open, region.close);
    const bindingRe = new RegExp(
      `\\b${region.itemVar}\\s*\\.\\s*${from}\\b`,
      "g"
    );
    const replaced = body.replace(bindingRe, `${region.itemVar}.${to}`);
    if (replaced !== body) s.overwrite(region.open, region.close, replaced);
  }

  await fs.writeFile(full, s.toString(), "utf-8");
  return { success: true };
}

/** Remove a field from every item object (data only). Any leftover
 *  `{itemVar.field}` binding renders empty — we don't touch the markup, to
 *  avoid mangling a card the user may have restyled. */
export async function removeArrayField(
  projectPath: string,
  relPath: string,
  arrayName: string,
  fieldName: string
): Promise<WriteComponentArrayResult> {
  const ctx = await fieldOpContext(projectPath, relPath, arrayName);
  if ("error" in ctx) return { success: false, error: ctx.error };
  const { full, source, fm, sf, array } = ctx;

  const objs = objectLiterals(array);
  const s = new MagicString(source);
  let removedAny = false;
  for (const obj of objs) {
    const prop = findProp(obj, fieldName);
    if (!prop) continue;
    removedAny = true;
    // Remove the property line including indentation + trailing comma.
    const propStartInContent = prop.getStart(sf);
    const lineStart = fm.content.lastIndexOf("\n", propStartInContent - 1) + 1;
    let endInContent = prop.getEnd();
    while (endInContent < fm.content.length && /[ \t]/.test(fm.content[endInContent])) {
      endInContent++;
    }
    if (fm.content[endInContent] === ",") endInContent++;
    while (endInContent < fm.content.length && fm.content[endInContent] !== "\n") {
      endInContent++;
    }
    if (fm.content[endInContent] === "\n") endInContent++;
    s.remove(fm.start + lineStart, fm.start + endInContent);
  }
  if (!removedAny) {
    return { success: false, error: `Field \`${fieldName}\` not found.` };
  }

  await fs.writeFile(full, s.toString(), "utf-8");
  return { success: true };
}
