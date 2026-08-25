/**
 * Firebase Auth blocking function: beforeUserCreated.
 * Requires Identity Platform / Auth blocking functions enabled on the project.
 *
 * Admin SDK / privileged Identity Toolkit imports do NOT trigger this handler.
 * Client SDK createUserWithEmailAndPassword DOES.
 */

import { beforeUserCreated, HttpsError } from "firebase-functions/v2/identity";
import { env } from "../../config/env";
import { loadOwnerAuthConfig } from "./ownerAuthConfig";
import { evaluateUserCreation } from "./registrationGuard";

export const beforeUserCreatedGuard = beforeUserCreated(
  {
    region: env.FIREBASE_REGION,
    // Bound at deploy time via Secret Manager / Functions secrets.
    secrets: ["GOLDMETA_PINNED_OWNER_UID"]
  },
  (event) => {
    const config = loadOwnerAuthConfig(process.env);
    const decision = evaluateUserCreation({
      email: event.data?.email ?? null,
      uid: event.data?.uid ?? null,
      config
    });

    if (!decision.allow) {
      // Do not leak UID details to clients.
      throw new HttpsError("failed-precondition", decision.message);
    }
  }
);
