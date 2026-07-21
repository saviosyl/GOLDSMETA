import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env";

const baseEnv = {
  NODE_ENV: "test",
  APP_ENV: "test",
  STORAGE_BACKEND: "memory",
  ALLOW_TEST_AUTH_HEADER: "true"
};

describe("parseEnv", () => {
  it("rejects memory storage in production", () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        NODE_ENV: "production",
        APP_ENV: "production",
        STORAGE_BACKEND: "memory",
        ALLOW_TEST_AUTH_HEADER: "false",
        FIREBASE_PROJECT_ID: "goldmeta-prod"
      })
    ).toThrow(/STORAGE_BACKEND must be firestore/);
  });

  it("rejects test auth headers in production", () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        NODE_ENV: "production",
        APP_ENV: "production",
        STORAGE_BACKEND: "firestore",
        ALLOW_TEST_AUTH_HEADER: "true",
        FIREBASE_PROJECT_ID: "goldmeta-prod"
      })
    ).toThrow(/ALLOW_TEST_AUTH_HEADER/);
  });

  it("accepts production firestore configuration", () => {
    expect(
      parseEnv({
        ...baseEnv,
        NODE_ENV: "production",
        APP_ENV: "production",
        STORAGE_BACKEND: "firestore",
        ALLOW_TEST_AUTH_HEADER: "false",
        FIREBASE_PROJECT_ID: "goldmeta-prod"
      }).STORAGE_BACKEND
    ).toBe("firestore");
  });

  it("resolves production project id from GCLOUD_PROJECT when FIREBASE_* is unset", () => {
    const parsed = parseEnv({
      ...baseEnv,
      NODE_ENV: "production",
      APP_ENV: "production",
      STORAGE_BACKEND: "firestore",
      ALLOW_TEST_AUTH_HEADER: "false",
      GCLOUD_PROJECT: "goldmeta-web"
    });
    expect(parsed.FIREBASE_PROJECT_ID).toBe("goldmeta-web");
    expect(parsed.FIREBASE_REGION).toBe("us-central1");
  });
});
