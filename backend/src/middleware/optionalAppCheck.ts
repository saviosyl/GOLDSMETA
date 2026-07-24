import type { RequestHandler } from "express";
import { getFirebaseApp } from "../services/firebaseAdmin";

/**
 * Optional Firebase App Check verification.
 * Enabled when APP_CHECK_ENFORCE=true and Admin SDK is available.
 * Missing/invalid tokens are rejected only when enforced.
 */
export const optionalAppCheck: RequestHandler = async (req, res, next) => {
  const enforce =
    (process.env.APP_CHECK_ENFORCE ?? "").trim().toLowerCase() === "true" ||
    (process.env.APP_CHECK_ENFORCE ?? "").trim() === "1";
  if (!enforce) {
    next();
    return;
  }

  const token = req.header("X-Firebase-AppCheck") ?? req.header("x-firebase-appcheck");
  if (!token) {
    res.status(401).json({
      error: { code: "APP_CHECK_REQUIRED", message: "App Check token required." }
    });
    return;
  }

  const app = getFirebaseApp();
  if (!app) {
    // Fail closed when enforcement is on but Admin is unavailable.
    res.status(503).json({
      error: { code: "APP_CHECK_UNAVAILABLE", message: "App Check unavailable." }
    });
    return;
  }

  try {
    // Dynamic import keeps local/test builds working without app-check types wired everywhere.
    const appCheck = await import("firebase-admin/app-check");
    await appCheck.getAppCheck(app).verifyToken(token);
    next();
  } catch {
    res.status(401).json({
      error: { code: "APP_CHECK_INVALID", message: "Invalid App Check token." }
    });
  }
};
