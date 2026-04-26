import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Real-git tests bootstrap repos in tmpdir — give them headroom.
    testTimeout: 15000,
  },
});
