import { describe, it, expect } from "vitest";
import {
  parseClasses,
  joinClasses,
  getClassByPrefix,
  getClassesByPrefix,
  hasClass,
  addClass,
  removeClass,
  replaceClassByPrefix,
  replaceClassFromSet,
  toggleClass,
  extractValue,
} from "./class-utils";

describe("parseClasses", () => {
  it.each([
    ["", []],
    ["p-4", ["p-4"]],
    ["p-4 mx-auto text-lg", ["p-4", "mx-auto", "text-lg"]],
    ["  p-4   mx-auto  ", ["p-4", "mx-auto"]],
    ["p-4\nmx-auto\ttext-lg", ["p-4", "mx-auto", "text-lg"]],
  ])("'%s' → %j", (input, expected) => {
    expect(parseClasses(input)).toEqual(expected);
  });
});

describe("joinClasses", () => {
  it("joins with single spaces", () => {
    expect(joinClasses(["p-4", "mx-auto"])).toBe("p-4 mx-auto");
  });
  it("returns empty string for empty array", () => {
    expect(joinClasses([])).toBe("");
  });
});

describe("getClassByPrefix", () => {
  it("finds first matching class", () => {
    expect(getClassByPrefix("p-4 mx-auto", "p-")).toBe("p-4");
  });
  it("returns null when no match", () => {
    expect(getClassByPrefix("mx-auto", "p-")).toBeNull();
  });
  it("matches exact prefix without trailing", () => {
    expect(getClassByPrefix("flex justify-center", "flex")).toBe("flex");
  });
});

describe("getClassesByPrefix", () => {
  it("returns all matches", () => {
    expect(getClassesByPrefix("pt-4 pb-2 mx-auto", "p")).toEqual(["pt-4", "pb-2"]);
  });
  it("returns empty array when none match", () => {
    expect(getClassesByPrefix("mx-auto", "p")).toEqual([]);
  });
});

describe("hasClass", () => {
  it("matches exactly, not partially", () => {
    // bg-blue-600 should NOT match `bg-blue` (this is the regex \b bug we explicitly avoid)
    expect(hasClass("bg-blue-600", "bg-blue")).toBe(false);
    expect(hasClass("bg-blue-600", "bg-blue-600")).toBe(true);
  });
  it("returns false for missing class", () => {
    expect(hasClass("p-4 mx-auto", "p-8")).toBe(false);
  });
});

describe("addClass", () => {
  it("appends when missing", () => {
    expect(addClass("p-4", "mx-auto")).toBe("p-4 mx-auto");
  });
  it("is idempotent — duplicates are not added", () => {
    expect(addClass("p-4 mx-auto", "p-4")).toBe("p-4 mx-auto");
  });
  it("works on empty string", () => {
    expect(addClass("", "p-4")).toBe("p-4");
  });
});

describe("removeClass", () => {
  it("removes the exact class", () => {
    expect(removeClass("p-4 mx-auto text-lg", "mx-auto")).toBe("p-4 text-lg");
  });
  it("is a no-op when class is absent", () => {
    expect(removeClass("p-4 mx-auto", "p-8")).toBe("p-4 mx-auto");
  });
  it("doesn't remove similar classes (exact-match only)", () => {
    expect(removeClass("bg-blue-600 bg-blue-700", "bg-blue")).toBe("bg-blue-600 bg-blue-700");
  });
});

describe("replaceClassByPrefix", () => {
  it("replaces the first matching prefix", () => {
    expect(replaceClassByPrefix("p-4 text-lg mx-auto", "p-", "p-8")).toBe(
      "text-lg mx-auto p-8"
    );
  });
  it("replaces all classes sharing the prefix", () => {
    // pt-4 pb-2 are both "p" prefixes → both removed, replaced once
    expect(replaceClassByPrefix("pt-4 pb-2 mx-auto", "p", "p-8")).toBe("mx-auto p-8");
  });
  it("removes when newClass is empty", () => {
    expect(replaceClassByPrefix("p-4 mx-auto", "p-", "")).toBe("mx-auto");
  });
  it("appends when prefix doesn't match anything", () => {
    expect(replaceClassByPrefix("mx-auto", "p-", "p-4")).toBe("mx-auto p-4");
  });
});

describe("replaceClassFromSet", () => {
  it("removes mutually-exclusive classes and adds new one", () => {
    expect(replaceClassFromSet("flex inline-flex grid", ["flex", "inline-flex", "grid", "block"], "block")).toBe(
      "block"
    );
  });
  it("just removes when newClass is empty", () => {
    expect(replaceClassFromSet("flex grid p-4", ["flex", "grid"], "")).toBe("p-4");
  });
});

describe("toggleClass", () => {
  it("removes when present", () => {
    expect(toggleClass("p-4 mx-auto", "mx-auto")).toBe("p-4");
  });
  it("adds when absent", () => {
    expect(toggleClass("p-4", "mx-auto")).toBe("p-4 mx-auto");
  });
});

describe("extractValue", () => {
  // Strips everything after the first hyphen. Greedy match — multi-segment
  // classes like bg-blue-600 return "blue-600", not just "600". This matches
  // how the editor uses it for simple single-segment value classes.
  it.each([
    ["p-4", "4"],
    ["mx-auto", "auto"],
    ["pt-0.5", "0.5"],
    ["text-lg", "lg"],
    ["bg-blue-600", "blue-600"],
  ])("'%s' → '%s'", (input, expected) => {
    expect(extractValue(input)).toBe(expected);
  });
});
