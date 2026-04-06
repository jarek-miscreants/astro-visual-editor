/**
 * Utilities for parsing and manipulating Tailwind CSS classes on elements.
 * Handles extracting current values, replacing classes by prefix, etc.
 */

/** Parse a class string into an array */
export function parseClasses(classes: string): string[] {
  return classes.split(/\s+/).filter(Boolean);
}

/** Join classes back into a string */
export function joinClasses(classes: string[]): string {
  return classes.join(" ");
}

/**
 * Get the current value for a Tailwind prefix.
 * E.g., getClassByPrefix("p-4 mx-auto text-lg", "p-") => "p-4"
 */
export function getClassByPrefix(classes: string, prefix: string): string | null {
  const list = parseClasses(classes);
  return list.find((c) => c === prefix || c.startsWith(prefix)) || null;
}

/**
 * Get all classes matching a prefix.
 * E.g., getClassesByPrefix("pt-4 pb-2 mx-auto", "p") => ["pt-4", "pb-2"]
 */
export function getClassesByPrefix(classes: string, prefix: string): string[] {
  return parseClasses(classes).filter((c) => c.startsWith(prefix));
}

/**
 * Check if a class string contains a specific class.
 */
export function hasClass(classes: string, className: string): boolean {
  return parseClasses(classes).includes(className);
}

/**
 * Add a class if not already present.
 */
export function addClass(classes: string, className: string): string {
  const list = parseClasses(classes);
  if (!list.includes(className)) list.push(className);
  return joinClasses(list);
}

/**
 * Remove a specific class.
 */
export function removeClass(classes: string, className: string): string {
  return joinClasses(parseClasses(classes).filter((c) => c !== className));
}

/**
 * Replace all classes matching a prefix with a new class.
 * If newClass is empty, just removes matching classes.
 * E.g., replaceClassByPrefix("p-4 text-lg mx-auto", "p-", "p-8") => "p-8 text-lg mx-auto"
 */
export function replaceClassByPrefix(
  classes: string,
  prefix: string,
  newClass: string
): string {
  const list = parseClasses(classes).filter(
    (c) => c !== prefix && !c.startsWith(prefix)
  );
  if (newClass) list.push(newClass);
  return joinClasses(list);
}

/**
 * Replace classes matching any of the given exact values with a new class.
 * Useful for mutually-exclusive classes like display or position.
 */
export function replaceClassFromSet(
  classes: string,
  classSet: string[],
  newClass: string
): string {
  const setLookup = new Set(classSet);
  const list = parseClasses(classes).filter((c) => !setLookup.has(c));
  if (newClass) list.push(newClass);
  return joinClasses(list);
}

/**
 * Toggle a class on/off.
 */
export function toggleClass(classes: string, className: string): string {
  return hasClass(classes, className)
    ? removeClass(classes, className)
    : addClass(classes, className);
}

/**
 * Extract the numeric value from a Tailwind spacing class.
 * E.g., "p-4" => "4", "mx-auto" => "auto", "pt-0.5" => "0.5"
 */
export function extractValue(className: string): string | null {
  const match = className.match(/-(\[?.+\]?)$/);
  return match ? match[1] : null;
}

/** Tailwind spacing scale */
export const SPACING_SCALE = [
  "0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7",
  "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40",
  "44", "48", "52", "56", "60", "64", "72", "80", "96", "auto",
];

/** Spacing scale with pixel values for display */
export const SPACING_LABELS: Record<string, string> = {
  "0": "0px", "px": "1px", "0.5": "2px", "1": "4px", "1.5": "6px",
  "2": "8px", "2.5": "10px", "3": "12px", "3.5": "14px", "4": "16px",
  "5": "20px", "6": "24px", "7": "28px", "8": "32px", "9": "36px",
  "10": "40px", "11": "44px", "12": "48px", "14": "56px", "16": "64px",
  "20": "80px", "24": "96px", "28": "112px", "32": "128px", "36": "144px",
  "40": "160px", "44": "176px", "48": "192px", "52": "208px", "56": "224px",
  "60": "240px", "64": "256px", "72": "288px", "80": "320px", "96": "384px",
  "auto": "auto",
};
