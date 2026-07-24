import type { ApprovalStatus, AccountRole } from "./roles";
import { defaultBrokerFlags } from "./roles";

export type UserProfileRecord = {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  countryOfResidence: string;
  role: AccountRole;
  approvalStatus: ApprovalStatus;
  emailVerified: boolean;
  brokerAccess: boolean;
  brokerExecution: boolean;
  autoTrade: boolean;
  liveTrading: boolean;
  demoOrderSubmission: boolean;
  acceptedTermsAt: string;
  acceptedPrivacyAt: string;
  acceptedRiskWarningAt: string;
  termsVersion: string;
  privacyVersion: string;
  riskVersion: string;
  registrationSource: string;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
  suspendedAt: string | null;
  rejectedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  registrationIncomplete?: boolean;
  idempotencyKey?: string | null;
};

export type AdminAuditEvent = {
  id: string;
  at: string;
  actorUidMasked: string;
  actorRole: AccountRole;
  action: string;
  targetUidMasked: string;
  detail: string;
};

export function buildPendingProfile(input: {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  countryOfResidence: string;
  emailVerified?: boolean;
  now?: string;
  termsVersion?: string;
  privacyVersion?: string;
  riskVersion?: string;
  registrationSource?: string;
  idempotencyKey?: string | null;
  incomplete?: boolean;
}): UserProfileRecord {
  const now = input.now ?? new Date().toISOString();
  const flags = defaultBrokerFlags();
  return {
    uid: input.uid,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    countryOfResidence: input.countryOfResidence,
    role: "USER_PENDING",
    approvalStatus: input.incomplete ? "REGISTRATION_INCOMPLETE" : "PENDING",
    emailVerified: Boolean(input.emailVerified),
    ...flags,
    acceptedTermsAt: now,
    acceptedPrivacyAt: now,
    acceptedRiskWarningAt: now,
    termsVersion: input.termsVersion ?? "2026-07-24",
    privacyVersion: input.privacyVersion ?? "2026-07-24",
    riskVersion: input.riskVersion ?? "2026-07-24",
    registrationSource: input.registrationSource ?? "web_register",
    createdAt: now,
    updatedAt: now,
    lastSignInAt: null,
    suspendedAt: null,
    rejectedAt: null,
    approvedAt: null,
    approvedBy: null,
    registrationIncomplete: Boolean(input.incomplete),
    idempotencyKey: input.idempotencyKey ?? null
  };
}

export function publicProfileView(profile: UserProfileRecord) {
  return {
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    countryOfResidence: profile.countryOfResidence,
    role: profile.role,
    approvalStatus: profile.approvalStatus,
    emailVerified: profile.emailVerified,
    brokerAccess: profile.brokerAccess,
    brokerExecution: profile.brokerExecution,
    autoTrade: profile.autoTrade,
    liveTrading: profile.liveTrading,
    demoOrderSubmission: profile.demoOrderSubmission,
    brokerMessage: profile.brokerAccess
      ? null
      : "Broker access has not been enabled for this account.",
    tradingDisclaimer:
      "Registration does not enable trading. Financial results are not guaranteed. GoldMeta is not an investment adviser and does not claim regulatory approval for brokerage services.",
    createdAt: profile.createdAt,
    lastSignInAt: profile.lastSignInAt,
    termsVersion: profile.termsVersion,
    privacyVersion: profile.privacyVersion,
    riskVersion: profile.riskVersion
  };
}

export function adminUserListItem(
  profile: UserProfileRecord,
  maskUid: (uid: string) => string
) {
  return {
    userId: profile.uid,
    userIdMasked: maskUid(profile.uid),
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    registeredAt: profile.createdAt,
    emailVerified: profile.emailVerified,
    approvalStatus: profile.approvalStatus,
    role: profile.role,
    lastSignInAt: profile.lastSignInAt,
    suspended: profile.approvalStatus === "SUSPENDED" || profile.role === "USER_SUSPENDED",
    registrationIncomplete: Boolean(profile.registrationIncomplete)
  };
}
