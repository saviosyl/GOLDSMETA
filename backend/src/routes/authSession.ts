import { Router } from "express";
import { getAuth } from "firebase-admin/auth";
import { requireAuth } from "../middleware/auth";
import { getFirebaseApp } from "../services/firebaseAdmin";
import { tryActivateVerifiedPendingUser } from "../services/auth/activateVerifiedUser";
import { loadOwnerAuthConfig, maskUid } from "../services/auth/ownerAuthConfig";
import { checkVerificationResendRateLimit } from "../services/auth/registrationRateLimit";
import {
  approvalStatusForRole,
  canAccessApprovedApp,
  defaultBrokerFlags,
  type AccountRole
} from "../services/auth/roles";
import { publicProfileView, type UserProfileRecord } from "../services/auth/userProfile";
import { getUserProfileStore } from "../services/auth/userProfileStore";

export const buildAuthSessionRouter = (): Router => {
  const router = Router();

  router.get("/v1/auth/me", requireAuth, async (req, res) => {
    const uid = req.userId!;
    const owner = loadOwnerAuthConfig();
    let role: AccountRole = req.accountRole ?? "USER_PENDING";

    const profiles = getUserProfileStore();
    let profile = await profiles.getProfile(uid);

    // Ensure pinned owner always surfaces as OWNER without mutating Auth unless needed.
    if (owner.pinnedOwnerUid && uid === owner.pinnedOwnerUid) {
      role = "OWNER";
      if (!profile) {
        profile = {
          uid,
          email: owner.ownerEmail,
          firstName: "Owner",
          lastName: "Account",
          countryOfResidence: "IE",
          role: "OWNER",
          approvalStatus: "APPROVED",
          emailVerified: true,
          ...defaultBrokerFlags(),
          brokerAccess: true,
          acceptedTermsAt: new Date().toISOString(),
          acceptedPrivacyAt: new Date().toISOString(),
          acceptedRiskWarningAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSignInAt: new Date().toISOString(),
          suspendedAt: null,
          rejectedAt: null,
          approvedAt: new Date().toISOString(),
          approvedBy: "system",
          termsVersion: "1.0",
          privacyVersion: "1.0",
          riskVersion: "1.0",
          registrationSource: "owner-bootstrap"
        };
        // Do not persist synthetic owner profile in production unless already present —
        // read-only synthesis for access decisions. Persist only in memory/test store.
        if (process.env.APP_ENV === "test" || process.env.STORAGE_BACKEND === "memory") {
          await profiles.upsertProfile(profile);
        }
      } else if (profile.role !== "OWNER") {
        profile = {
          ...profile,
          role: "OWNER",
          approvalStatus: "APPROVED",
          brokerAccess: true,
          updatedAt: new Date().toISOString()
        };
        await profiles.upsertProfile(profile);
      }
    }

    if (profile) {
      role = profile.role === "OWNER" || owner.pinnedOwnerUid === uid ? "OWNER" : profile.role;
      const emailVerifiedHint =
        role === "OWNER" || role === "ADMIN"
          ? true
          : (req.emailVerified ?? profile.emailVerified);
      const nextProfile: UserProfileRecord = {
        ...profile,
        emailVerified: emailVerifiedHint,
        lastSignInAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      profile = nextProfile;
      await profiles.upsertProfile(nextProfile);

      // Auto-activate basic app access after email verification (open mode).
      if (role === "USER_PENDING" && emailVerifiedHint) {
        const activation = await tryActivateVerifiedPendingUser({
          uid,
          emailVerified: true,
          profiles
        });
        if (activation.profile) {
          profile = activation.profile;
          role = activation.role;
        }
      }
    } else if (req.legacyUnclaimed && role === "USER_PENDING") {
      // Pre-registration production users: analysis access without approval gate.
      role = "USER_APPROVED";
    }

    const emailVerified =
      role === "OWNER" || role === "ADMIN"
        ? true
        : (req.emailVerified ?? profile?.emailVerified ?? false);
    const access =
      role === "USER_SUSPENDED"
        ? "SUSPENDED"
        : !emailVerified
          ? "VERIFY_EMAIL"
          : role === "USER_PENDING"
            ? "AWAITING_APPROVAL"
            : canAccessApprovedApp(role)
              ? "APP"
              : "FORBIDDEN";

    res.status(200).json({
      uidMasked: maskUid(uid),
      role,
      approvalStatus: profile?.approvalStatus ?? approvalStatusForRole(role),
      emailVerified,
      access,
      profile: profile ? publicProfileView({ ...profile, role, emailVerified }) : null,
      registration: {
        brokerEnabledByRegistration: false,
        autoTradeDefault: "OFF"
      }
    });
  });

  router.post("/v1/auth/resend-verification", requireAuth, async (req, res) => {
    const uid = req.userId!;
    const rate = await checkVerificationResendRateLimit({ uid });
    if (!rate.allowed) {
      res.status(429).json({ error: { code: rate.code, message: rate.message } });
      return;
    }

    // Generic success — avoid account enumeration / status leaks.
    const generic = {
      message: "If verification is required, an email will be sent shortly."
    };

    const app = getFirebaseApp();
    if (!app) {
      res.status(200).json(generic);
      return;
    }
    try {
      const auth = getAuth(app);
      const user = await auth.getUser(uid);
      if (user.email && !user.emailVerified) {
        await auth.generateEmailVerificationLink(user.email);
      }
    } catch {
      // swallow — generic response
    }
    res.status(200).json(generic);
  });

  return router;
};
