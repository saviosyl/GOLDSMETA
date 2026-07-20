import express, { type ErrorRequestHandler } from "express";
import { onRequest } from "firebase-functions/v2/https";
import { env } from "./config/env";
import { buildDecisionsRouter } from "./routes/decisions";
import { buildDevicesRouter } from "./routes/devices";
import { buildHealthRouter } from "./routes/health";
import { buildJournalRouter } from "./routes/journal";
import { buildSettingsRouter } from "./routes/settings";
import { buildSystemRouter } from "./routes/system";
import { buildWebhooksRouter } from "./routes/webhooks";
import { AiExplainer } from "./services/ai/explainer";
import { globalStore, InMemoryStore } from "./services/storage/inMemoryStore";
import { DedupeStore } from "./services/webhook/dedupe";

export interface AppDependencies {
  store: InMemoryStore;
  dedupe: DedupeStore;
  aiExplainer: AiExplainer;
}

const isPayloadTooLarge = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const maybeError = error as { type?: unknown; status?: unknown };
  return maybeError.type === "entity.too.large" || maybeError.status === 413;
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (isPayloadTooLarge(error)) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Payload exceeds configured limit"
      }
    });
    return;
  }

  res.status(400).json({
    error: {
      code: "BAD_REQUEST",
      message: "Request could not be parsed"
    }
  });
};

export const createApp = (
  dependencies: AppDependencies = {
    store: globalStore,
    dedupe: new DedupeStore(env.WEBHOOK_MAX_SKEW_MS * 2),
    aiExplainer: new AiExplainer()
  }
): express.Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: env.PAYLOAD_SIZE_LIMIT }));

  app.use(buildHealthRouter());
  app.use(buildWebhooksRouter(dependencies.store, dependencies.dedupe, dependencies.aiExplainer));
  app.use(buildDevicesRouter(dependencies.store));
  app.use(buildDecisionsRouter(dependencies.store));
  app.use(buildJournalRouter(dependencies.store));
  app.use(buildSettingsRouter(dependencies.store));
  app.use(buildSystemRouter());
  app.use(errorHandler);

  return app;
};

export const app = createApp();
export const api = onRequest(app);

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`GoldMeta backend listening on ${env.PORT}`);
  });
}
