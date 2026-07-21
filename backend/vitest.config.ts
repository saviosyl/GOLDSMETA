import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      APP_ENV: "test",
      NODE_ENV: "test",
      STORAGE_BACKEND: "memory",
      ALLOW_TEST_AUTH_HEADER: "true",
      SETUP_TRACKING_ENVIRONMENTS: "TEST,LIVE",
      BROKER_MODE: "DISABLED",
      AI_ENABLED: "false"
    },
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    exclude: ["node_modules/**", "dist/**"]
  }
});
