import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: "file:./test.db",
      DRAFTLINE_STAGE_DELAY_MS: "0",
      DRAFTLINE_RETRY_DELAY_MS: "0",
      DRAFTLINE_MODE: "mock",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
