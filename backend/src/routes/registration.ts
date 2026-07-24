import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadOwnerAuthConfig, normalizeEmail } from "../services/auth/ownerAuthConfig";
import {
  OWNER_EXISTS_MESSAGE,
  OWNER_EXISTS_REGISTER_HINT
} from "../services/auth/roles";
import {
  finalizeClientRegistration,
  registerUser
} from "../services/auth/registrationService";
import { isPublicRegistrationEnabled } from "../services/auth/registrationGuard";
import { validateRegistrationInput } from "../services/auth/registrationValidation";

export const buildRegistrationRouter = (): Router => {
  const router = Router();

  router.get("/v1/auth/registration-status", (_req, res) => {
    res.status(200).json({
      registrationEnabled: isPublicRegistrationEnabled(),
      emailVerificationRequired: true,
      approvalRequired: true,
      brokerEnabledByRegistration: false,
      autoTradeDefault: "OFF",
      messages: {
        complete:
          "Account created. Please verify your email. Your account will then be reviewed before full access is enabled.",
        ownerExists: OWNER_EXISTS_MESSAGE,
        ownerExistsHint: OWNER_EXISTS_REGISTER_HINT,
        broker:
          "Broker access has not been enabled for this account. Demo and Live trading are separate. AutoTrade is disabled by default."
      }
    });
  });

  router.post("/v1/auth/register/preflight", (req, res) => {
    if (!isPublicRegistrationEnabled()) {
      res.status(403).json({
        error: { code: "REGISTRATION_CLOSED", message: "Account registration is currently closed." }
      });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(typeof body.email === "string" ? body.email : null);
    const owner = loadOwnerAuthConfig();
    if (email && email === owner.ownerEmail) {
      res.status(409).json({
        error: { code: "ACCOUNT_EXISTS", message: OWNER_EXISTS_MESSAGE },
        hint: OWNER_EXISTS_REGISTER_HINT
      });
      return;
    }
    const validated = validateRegistrationInput(req.body);
    if (!validated.ok) {
      res.status(validated.status).json({
        error: {
          code: validated.code,
          message: validated.message,
          fieldErrors: validated.fieldErrors
        }
      });
      return;
    }
    res.status(200).json({ ok: true });
  });

  /** Server-side registration (Admin SDK). Preferred path — rate limited + validated. */
  router.post("/v1/auth/register", async (req, res) => {
    if (!isPublicRegistrationEnabled()) {
      res.status(403).json({
        error: { code: "REGISTRATION_CLOSED", message: "Account registration is currently closed." }
      });
      return;
    }
    const result = await registerUser({
      body: req.body,
      ip: req.ip ?? req.socket.remoteAddress
    });
    res.status(result.status).json(result.ok ? result.body : result.body);
  });

  /**
   * Finalize after client Firebase createUser + sendEmailVerification.
   * Creates USER_PENDING profile; never creates webhooks/broker links.
   */
  router.post("/v1/auth/register/finalize", requireAuth, async (req, res) => {
    if (!req.userId) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const headerEmail = req.header("x-test-email");
    const result = await finalizeClientRegistration({
      uid: req.userId,
      email: typeof body.email === "string" ? body.email : headerEmail,
      emailVerified: req.emailVerified === true,
      body
    });
    res.status(result.status).json(result.ok ? result.body : result.body);
  });

  return router;
};
