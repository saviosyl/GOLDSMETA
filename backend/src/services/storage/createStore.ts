import { env } from "../../config/env";
import { getFirestoreDb } from "../firebaseAdmin";
import { FirestoreGoldMetaStore } from "./firestoreStore";
import { InMemoryStore } from "./inMemoryStore";
import type { GoldMetaStore } from "./types";

export const createStore = (): GoldMetaStore => {
  if (env.APP_ENV === "test" || env.STORAGE_BACKEND === "memory") {
    if (env.APP_ENV === "production") {
      throw new Error("STORAGE_BACKEND=memory is not allowed when APP_ENV=production");
    }
    return new InMemoryStore();
  }

  const firestore = getFirestoreDb();
  if (!firestore) {
    if (env.APP_ENV === "production") {
      throw new Error("Firestore Admin is required when APP_ENV=production");
    }
    throw new Error("Firestore Admin is unavailable; set STORAGE_BACKEND=memory only for development/test");
  }

  return new FirestoreGoldMetaStore(firestore);
};
