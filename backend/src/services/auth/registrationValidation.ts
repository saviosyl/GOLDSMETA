import { z } from "zod";
import { loadOwnerAuthConfig, normalizeEmail } from "./ownerAuthConfig";
import { OWNER_EXISTS_MESSAGE } from "./roles";

export const PASSWORD_MIN_LENGTH = 10;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character");

export const registrationBodySchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    email: z.string().trim().email("Enter a valid email address").max(254),
    password: passwordSchema,
    confirmPassword: z.string(),
    countryOfResidence: z.string().trim().min(2, "Country is required").max(80),
    acceptTerms: z.boolean(),
    acceptPrivacy: z.boolean(),
    acceptRiskWarning: z.boolean()
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match"
      });
    }
    if (value.acceptTerms !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptTerms"],
        message: "You must accept the Terms"
      });
    }
    if (value.acceptPrivacy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptPrivacy"],
        message: "You must accept the Privacy Policy"
      });
    }
    if (value.acceptRiskWarning !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptRiskWarning"],
        message: "You must accept the CFD / high-risk warning"
      });
    }
  });

export type RegistrationInput = z.infer<typeof registrationBodySchema>;

export type RegistrationValidationResult =
  | { ok: true; value: RegistrationInput & { emailNormalized: string } }
  | { ok: false; status: number; code: string; message: string; fieldErrors?: Record<string, string> };

export function validateRegistrationInput(
  body: unknown,
  env: NodeJS.ProcessEnv = process.env
): RegistrationValidationResult {
  const parsed = registrationBodySchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] ? String(issue.path[0]) : "form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    const first = parsed.error.issues[0]?.message ?? "Invalid registration details";
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_FAILED",
      message: first,
      fieldErrors
    };
  }

  const emailNormalized = normalizeEmail(parsed.data.email);
  if (!emailNormalized) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Enter a valid email address",
      fieldErrors: { email: "Enter a valid email address" }
    };
  }

  const owner = loadOwnerAuthConfig(env);
  if (emailNormalized === owner.ownerEmail) {
    return {
      ok: false,
      status: 409,
      code: "ACCOUNT_EXISTS",
      message: OWNER_EXISTS_MESSAGE
    };
  }

  return {
    ok: true,
    value: { ...parsed.data, email: emailNormalized, emailNormalized }
  };
}

export function isStrongPassword(password: string): boolean {
  return passwordSchema.safeParse(password).success;
}

/** Profile fields only — used after Firebase Auth already created the user. */
export const registrationProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    countryOfResidence: z.string().trim().min(2, "Country is required").max(80),
    acceptTerms: z.boolean(),
    acceptPrivacy: z.boolean(),
    acceptRiskWarning: z.boolean()
  })
  .superRefine((value, ctx) => {
    if (value.acceptTerms !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptTerms"],
        message: "You must accept the Terms"
      });
    }
    if (value.acceptPrivacy !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptPrivacy"],
        message: "You must accept the Privacy Policy"
      });
    }
    if (value.acceptRiskWarning !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptRiskWarning"],
        message: "You must accept the CFD / high-risk warning"
      });
    }
  });

export type RegistrationProfileInput = z.infer<typeof registrationProfileSchema>;
