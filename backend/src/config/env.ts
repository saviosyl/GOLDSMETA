import "dotenv/config";
import { z } from "zod";

const appEnvSchema = z.enum(["development", "test", "production"]);
const storageBackendSchema = z.enum(["memory", "firestore"]);

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
    throw new Error(`Expected boolean, received ${value}`);
  });

const intFromString = (defaultValue: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return defaultValue;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Expected non-negative integer, received ${String(value)}`);
      }
      return parsed;
    });

const envSchema = z.object({
  NODE_ENV: appEnvSchema.default("development"),
  APP_ENV: appEnvSchema,
  PORT: intFromString(8080),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_REGION: z.string().min(1).default("us-central1"),
  STORAGE_BACKEND: storageBackendSchema,
  ALLOW_TEST_AUTH_HEADER: booleanFromString,
  WEBHOOK_ID: z.string().min(8).optional(),
  WEBHOOK_SECRET: z.string().min(1).optional(),
  WEBHOOK_PUBLIC_BASE_URL: z.string().url().optional(),
  WEBHOOK_MAX_SKEW_MS: intFromString(5 * 60 * 1000),
  WEBHOOK_RATE_LIMIT_WINDOW_MS: intFromString(60 * 1000),
  WEBHOOK_RATE_LIMIT_MAX: intFromString(60),
  PAYLOAD_SIZE_LIMIT: z.string().default("128kb"),
  AI_ENABLED: booleanFromString.default(false),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  AI_MAX_CALLS_PER_HOUR: intFromString(20)
});

export type Env = z.infer<typeof envSchema>;

/** Resolve project id without requiring reserved FIREBASE_* / GCLOUD_PROJECT .env keys. */
const resolveFirebaseProjectId = (source: NodeJS.ProcessEnv): string | undefined => {
  if (source.FIREBASE_PROJECT_ID?.trim()) {
    return source.FIREBASE_PROJECT_ID.trim();
  }
  if (source.GOLDMETA_PROJECT_ID?.trim()) {
    return source.GOLDMETA_PROJECT_ID.trim();
  }
  if (source.GCLOUD_PROJECT?.trim()) {
    return source.GCLOUD_PROJECT.trim();
  }
  if (source.GCP_PROJECT?.trim()) {
    return source.GCP_PROJECT.trim();
  }
  const raw = source.FIREBASE_CONFIG?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { projectId?: unknown };
    return typeof parsed.projectId === "string" && parsed.projectId.length > 0
      ? parsed.projectId
      : undefined;
  } catch {
    return undefined;
  }
};

export const parseEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const nodeEnv = source.NODE_ENV ?? "development";
  const appEnv = source.APP_ENV ?? nodeEnv;
  const firebaseProjectId = resolveFirebaseProjectId(source);
  const storageBackend =
    source.STORAGE_BACKEND ??
    (appEnv === "production" || firebaseProjectId ? "firestore" : appEnv === "test" ? "memory" : undefined);
  const allowTestAuth =
    source.ALLOW_TEST_AUTH_HEADER ?? (appEnv === "test" && nodeEnv === "test" ? "true" : "false");

  const parsedEnv = envSchema.safeParse({
    ...source,
    NODE_ENV: nodeEnv,
    APP_ENV: appEnv,
    FIREBASE_PROJECT_ID: firebaseProjectId,
    FIREBASE_REGION: source.FIREBASE_REGION ?? source.FUNCTION_REGION ?? "us-central1",
    STORAGE_BACKEND: storageBackend,
    ALLOW_TEST_AUTH_HEADER: allowTestAuth,
    WEBHOOK_ID: source.WEBHOOK_ID ?? (appEnv === "test" ? "test-webhook-id" : undefined)
  });

  if (!parsedEnv.success) {
    const issues = parsedEnv.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid backend environment: ${issues}`);
  }

  const parsed = parsedEnv.data;
  const configurationErrors: string[] = [];

  if (parsed.APP_ENV === "production") {
    if (!parsed.FIREBASE_PROJECT_ID) {
      configurationErrors.push("FIREBASE_PROJECT_ID is required when APP_ENV=production");
    }
    if (parsed.STORAGE_BACKEND !== "firestore") {
      configurationErrors.push("STORAGE_BACKEND must be firestore when APP_ENV=production");
    }
    if (parsed.ALLOW_TEST_AUTH_HEADER) {
      configurationErrors.push("ALLOW_TEST_AUTH_HEADER must be false when APP_ENV=production");
    }
  }

  if (parsed.ALLOW_TEST_AUTH_HEADER && (parsed.APP_ENV !== "test" || parsed.NODE_ENV !== "test")) {
    configurationErrors.push(
      "ALLOW_TEST_AUTH_HEADER may only be true when APP_ENV=test and NODE_ENV=test"
    );
  }

  if (configurationErrors.length > 0) {
    throw new Error(`Invalid backend environment: ${configurationErrors.join("; ")}`);
  }

  return parsed;
};

export const env = parseEnv();
