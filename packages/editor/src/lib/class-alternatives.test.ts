import { describe, it, expect } from "vitest";
import { getAlternatives } from "./class-alternatives";

describe("getAlternatives", () => {
  describe("predefined groups", () => {
    it("font weight returns 9 weights", () => {
      const alts = getAlternatives("font-bold");
      expect(alts).toHaveLength(9);
      expect(alts[0].value).toBe("font-thin");
      expect(alts.at(-1)!.value).toBe("font-black");
    });

    it("text-align returns 4 options", () => {
      expect(getAlternatives("text-center").map((a) => a.value)).toEqual([
        "text-left",
        "text-center",
        "text-right",
        "text-justify",
      ]);
    });

    it("display returns full set including hidden", () => {
      const alts = getAlternatives("flex").map((a) => a.value);
      expect(alts).toContain("hidden");
      expect(alts).toContain("block");
      expect(alts).toContain("inline-flex");
    });

    it("font size returns the size scale", () => {
      const alts = getAlternatives("text-xl");
      expect(alts[0].value).toBe("text-xs");
      expect(alts.at(-1)!.value).toBe("text-9xl");
    });
  });

  describe("spacing patterns", () => {
    it("mt-4 returns mt-* with auto", () => {
      const alts = getAlternatives("mt-4");
      const values = alts.map((a) => a.value);
      expect(values).toContain("mt-0");
      expect(values).toContain("mt-4");
      expect(values).toContain("mt-auto"); // margins include auto
    });

    it("p-4 returns p-* without auto (padding doesn't take auto)", () => {
      const alts = getAlternatives("p-4");
      const values = alts.map((a) => a.value);
      expect(values).toContain("p-4");
      expect(values).not.toContain("p-auto");
    });

    it("pt-0.5 finds the spacing scale", () => {
      const alts = getAlternatives("pt-0.5");
      expect(alts.map((a) => a.value)).toContain("pt-0.5");
    });
  });

  describe("color patterns", () => {
    it("bg-blue-600 returns 11 shades with hex colors", () => {
      const alts = getAlternatives("bg-blue-600");
      expect(alts).toHaveLength(11);
      expect(alts[0].value).toBe("bg-blue-50");
      expect(alts[0].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(alts.find((a) => a.value === "bg-blue-600")?.color).toBe("#2563eb");
    });

    it("text-red-500 returns red shades", () => {
      const alts = getAlternatives("text-red-500");
      expect(alts).toHaveLength(11);
      expect(alts.every((a) => a.value.startsWith("text-red-"))).toBe(true);
    });

    it("bg-white returns transparent/white/black trio", () => {
      const alts = getAlternatives("bg-white");
      expect(alts.map((a) => a.value)).toEqual([
        "bg-transparent",
        "bg-white",
        "bg-black",
      ]);
    });
  });

  describe("responsive prefixes", () => {
    it("md:grid-cols-3 keeps the md: prefix in alternatives", () => {
      const alts = getAlternatives("md:grid-cols-3");
      expect(alts.length).toBeGreaterThan(1);
      expect(alts.every((a) => a.value.startsWith("md:"))).toBe(true);
      expect(alts.map((a) => a.value)).toContain("md:grid-cols-1");
      expect(alts.map((a) => a.value)).toContain("md:grid-cols-12");
    });

    it("lg:p-4 keeps the lg: prefix on spacing", () => {
      const alts = getAlternatives("lg:p-4");
      expect(alts.every((a) => a.value.startsWith("lg:"))).toBe(true);
    });

    it("hover: state prefix is preserved", () => {
      const alts = getAlternatives("hover:bg-blue-600");
      expect(alts.every((a) => a.value.startsWith("hover:"))).toBe(true);
    });
  });

  describe("grid + col-span", () => {
    it("grid-cols-3 returns 1..12", () => {
      const alts = getAlternatives("grid-cols-3");
      expect(alts).toHaveLength(12);
      expect(alts[0].value).toBe("grid-cols-1");
    });

    it("col-span-2 includes full", () => {
      const alts = getAlternatives("col-span-2");
      expect(alts.map((a) => a.value)).toContain("col-span-full");
    });
  });

  describe("z-index", () => {
    it("z-10 returns the z scale", () => {
      const alts = getAlternatives("z-10");
      expect(alts.map((a) => a.value)).toEqual(["z-auto", "z-0", "z-10", "z-20", "z-30", "z-40", "z-50"]);
    });
  });

  describe("fallback", () => {
    it("unknown class returns itself only", () => {
      const alts = getAlternatives("totally-made-up-class");
      expect(alts).toEqual([{ value: "totally-made-up-class" }]);
    });
  });
});
