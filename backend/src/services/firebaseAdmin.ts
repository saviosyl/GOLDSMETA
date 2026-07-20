import { applicationDefault, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { env } from "../config/env";
import { logger } from "./logging/logger";

let cachedApp: App | null | undefined;

export const getFirebaseApp = (): App | null => {
  if (cachedApp !== undefined) {
    return cachedApp;
  }

  const existingApp = getApps()[0];
  if (existingApp) {
    cachedApp = existingApp;
    return cachedApp;
  }

  if (!env.FIREBASE_PROJECT_ID && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    cachedApp = null;
    return cachedApp;
  }

  try {
    cachedApp = initializeApp({
      credential: applicationDefault(),
      projectId: env.FIREBASE_PROJECT_ID
    });
    return cachedApp;
  } catch (error: unknown) {
    logger.warn("Firebase Admin unavailable; using in-memory backend only", {
      error: error instanceof Error ? error.message : "unknown"
    });
    cachedApp = null;
    return cachedApp;
  }
};

export const verifyFirebaseIdToken = async (token: string): Promise<DecodedIdToken | null> => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  return getAuth(app).verifyIdToken(token);
};

export const sendFirebaseMessages = async (messages: Message[]): Promise<number> => {
  const app = getFirebaseApp();
  if (!app || messages.length === 0) {
    return 0;
  }
  const response = await getMessaging(app).sendEach(messages);
  return response.successCount;
};
