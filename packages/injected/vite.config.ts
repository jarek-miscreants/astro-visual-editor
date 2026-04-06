import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "TveInjected",
      formats: ["iife"],
      fileName: () => "injected.js",
    },
    outDir: "../server/public",
    emptyOutDir: false,
    minify: false,
  },
});
