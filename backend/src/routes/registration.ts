import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireJsonContentType } from "../middleware/requireJsonContentType";
import { optionalAppCheck } from "../middleware/optionalAppCheck";
import { loadOwnerAuthConfig, normalizeEmail } from "../services/auth/ownerAuthConfig";
import {
  OWNER_EXISTS_MESSAGE,
  OWNER_EXISTS_REGISTER_HINT
} from "../services/auth/roles";
import {
  finalizeClientRegistration,
  registerUser
} from "../services/auth/registrationService";
import { loadRegistrationConfig } from "../services/auth/registrationConfig";
import { validateRegistrationInput } from "../services/auth/registrationValidation";
import { checkPasswordResetRateLimit } from "../services/auth/registrationRateLimit";
import { getFirebaseApp } from "../services/firebaseAdmin";
import { getAuth } from "firebase-admin/auth";

export const buildRegistrationRouter = (): Router => {
  const router = Router();

  router.get("/v1/auth/registration-status", (_req, res) => {
    const cfg = loadRegistrationConfig();
    res.status(200).json({
      registrationEnabled: cfg.registrationEnabled,
      approvalRequired: cfg.approvalRequired,
      inviteOnly: cfg.inviteOnly,
      emailVerificationRequired: true,
      mode: cfg.approvalRequired ? "APPROVAL_REQUIRED" : "OPEN",
      newUserDefaultRole: cfg.newUserDefaultRole,
      brokerEnabledByRegistration: cfg.newUserBrokerAccess,
      autoTradeDefault: "OFF",
      policyVersions: cfg.policyVersions,
      messages: {
        complete:
          "Account created. Please verify your email. Your account will then be reviewed before full access is enabled.",
        ownerExists: OWNER_EXISTS_MESSAGE,
        ownerExistsHint: OWNER_EXISTS_REGISTER_HINT,
        broker:
          "Broker access has not been enabled for this account. Demo and Live trading are separate. AutoTrade is disabled by default.",
        tradingDisclaimer:
          "Registration does not enable trading. Financial results are not guaranteed."
      }
    });
  });

  router.post(
    "/v1/auth/register/preflight",
    requireJsonContentType,
    optionalAppCheck,
    (req, res) => {
      const cfg = loadRegistrationConfig();
      if (!cfg.registrationEnabled) {
        res.status(403).json({
          error: {
            code: "REGISTRATION_CLOSED",
            message: "Account registration is currently closed."
          }
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
    }
  );

  router.post(
    "/v1/auth/register",
    requireJsonContentType,
    optionalAppCheck,
    async (req, res) => {
      const result = await registerUser({
        body: req.body,
        ip: req.ip ?? req.socket.remoteAddress
      });
      res.status(result.status).json(result.ok ? result.body : result.body);
    }
  );

  router.post(
    "/v1/auth/register/finalize",
    requireAuth,
    requireJsonContentType,
    async (req, res) => {
      if (!req.userId) {
        res.status(401).json({
          error: { code: "UNAUTHENTICATED", message: "Authentication required" }
        });
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
    }
  );

  /**
   * Rate-limited password reset trigger. Always returns a generic message.
   * Does not reveal whether ordinary emails exist. Owner email is allowed
   * (targets existing Auth account only — never creates a user).
   */
  router.post(
    "/v1/auth/password-reset",
    requireJsonContentType,
    optionalAppCheck,
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = normalizeEmail(typeof body.email === "string" ? body.email : null);
      const generic = {
        message: "If an account exists for that email, a reset link has been sent."
      };
      if (!email) {
        res.status(200).json(generic);
        return;
      }
      const rate = await checkPasswordResetRateLimit({
        email,
        ip: req.ip ?? req.socket.remoteAddress
      });
      if (!rate.allowed) {
        res.status(429).json({ error: { code: rate.code, message: rate.message } });
        return;
      }
      const app = getFirebaseApp();
      if (app) {
        try {
          await getAuth(app).generatePasswordResetLink(email);
        } catch {
          // Generic response — no enumeration.
        }
      }
      res.status(200).json(generic);
    }
  );

  return router;
};
