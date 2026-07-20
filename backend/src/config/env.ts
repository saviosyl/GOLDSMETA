import "dotenv/config";
import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : value.toLowerCase() === "true"));

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

const defaultWebhookId = process.env.NODE_ENV === "test" ? "test-webhook-id" : undefined;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: intFromString(8080),
  WEBHOOK_ID: z.string().min(8).default(defaultWebhookId ?? "missing-webhook-id"),
  WEBHOOK_SECRET: z.string().min(1).optional(),
  WEBHOOK_MAX_SKEW_MS: intFromString(5 * 60 * 1000),
  WEBHOOK_RATE_LIMIT_WINDOW_MS: intFromString(60 * 1000),
  WEBHOOK_RATE_LIMIT_MAX: intFromString(60),
  PAYLOAD_SIZE_LIMIT: z.string().default("128kb"),
  AI_ENABLED: booleanFromString.default(false),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  AI_MAX_CALLS_PER_HOUR: intFromString(20),
  FIREBASE_PROJECT_ID: z.string().min(1).optional()
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid backend environment: ${issues}`);
}

if (parsedEnv.data.NODE_ENV !== "test" && parsedEnv.data.WEBHOOK_ID === "missing-webhook-id") {
  throw new Error("WEBHOOK_ID must be configured");
}

export const env = parsedEnv.data;
export type Env = typeof env;
