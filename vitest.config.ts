import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The default worker pools fail on this Windows + Node 24 setup ("failed to find the current suite").
    pool: "vmThreads",
  },
});
