export const OWNER_EMAIL = "saviosyl@gmail.com";

export const OWNER_EXISTS_MESSAGE =
  "This account already exists. Please use Sign In or Forgot Password.";

export const OWNER_EXISTS_HINT =
  "This account already exists. Use Forgot Password to recover access.";

export type RegistrationFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  countryOfResidence: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptRiskWarning: boolean;
};

export type RegistrationFieldErrors = Partial<Record<keyof RegistrationFormValues, string>>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 10 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function validateRegistrationForm(
  values: RegistrationFormValues
): { ok: true } | { ok: false; fieldErrors: RegistrationFieldErrors; message: string } {
  const fieldErrors: RegistrationFieldErrors = {};
  if (!values.firstName.trim()) fieldErrors.firstName = "First name is required";
  if (!values.lastName.trim()) fieldErrors.lastName = "Last name is required";
  const email = normalizeEmail(values.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Enter a valid email address";
  } else if (email === OWNER_EMAIL) {
    // Single primary message only — avoid duplicate banner + field copy.
    return {
      ok: false,
      fieldErrors: {},
      message: OWNER_EXISTS_MESSAGE
    };
  }
  if (!isStrongPassword(values.password)) {
    fieldErrors.password =
      "Password must be at least 10 characters and include upper, lower, number, and special character";
  }
  if (values.password !== values.confirmPassword) {
    fieldErrors.confirmPassword = "Passwords do not match";
  }
  if (!values.countryOfResidence.trim()) {
    fieldErrors.countryOfResidence = "Country is required";
  }
  if (!values.acceptTerms) fieldErrors.acceptTerms = "You must accept the Terms";
  if (!values.acceptPrivacy) fieldErrors.acceptPrivacy = "You must accept the Privacy Policy";
  if (!values.acceptRiskWarning) {
    fieldErrors.acceptRiskWarning = "You must accept the CFD / high-risk warning";
  }
  if (Object.keys(fieldErrors).length > 0) {
    const message = Object.values(fieldErrors)[0] ?? "Invalid registration details";
    return { ok: false, fieldErrors, message };
  }
  return { ok: true };
}
