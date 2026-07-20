import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      APP_ENV: "test",
      NODE_ENV: "test",
      STORAGE_BACKEND: "memory"
    },
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    exclude: ["node_modules/**", "dist/**"]
  }
});
