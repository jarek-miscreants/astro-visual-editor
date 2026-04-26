import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      // Match the workspace package alias the app uses
      "@tve/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
