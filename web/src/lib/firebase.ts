import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  type Auth,
  type User
} from "firebase/auth";
import { OWNER_EMAIL, OWNER_EXISTS_MESSAGE } from "./registrationValidation";
import { friendlyAuthError } from "./authErrors";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

const readConfig = (): FirebaseWebConfig | null => {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;
  if (!apiKey || !authDomain || !projectId || !appId) {
    return null;
  }
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined
  };
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export const isFirebaseConfigured = (): boolean => readConfig() !== null;

export const getFirebaseAuth = (): Auth => {
  const config = readConfig();
  if (!config) {
    throw new Error(
      "Firebase Web SDK is not configured. Set VITE_FIREBASE_* variables (see docs/WEB_PWA_SETUP.md)."
    );
  }
  if (!app) {
    app = initializeApp(config);
    auth = getAuth(app);
  }
  if (!auth) {
    auth = getAuth(app);
  }
  return auth;
};

export const subscribeAuth = (listener: (user: User | null) => void): (() => void) => {
  if (!isFirebaseConfigured()) {
    listener(null);
    return () => undefined;
  }
  return onAuthStateChanged(getFirebaseAuth(), listener);
};

export const signIn = async (email: string, password: string): Promise<User> => {
  try {
    const result = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    return result.user;
  } catch (error) {
    throw new Error(friendlyAuthError(error), { cause: error });
  }
};

/**
 * Client Firebase registration path (email/password).
 * Protected owner email is rejected before any Auth call.
 * Prefer server `/v1/auth/register` when available; this remains for finalize flows.
 */
export const signUp = async (email: string, password: string): Promise<User> => {
  const normalized = email.trim().toLowerCase();
  if (normalized === OWNER_EMAIL) {
    throw new Error(OWNER_EXISTS_MESSAGE);
  }
  try {
    const result = await createUserWithEmailAndPassword(
      getFirebaseAuth(),
      normalized,
      password
    );
    await sendEmailVerification(result.user);
    return result.user;
  } catch (error) {
    throw new Error(friendlyAuthError(error), { cause: error });
  }
};

export const isPublicRegistrationEnabled = (): boolean => {
  const raw = (import.meta.env.VITE_PUBLIC_REGISTRATION_ENABLED as string | undefined)?.trim();
  if (raw === "false" || raw === "0") return false;
  return true;
};

export const sendVerificationEmail = async (): Promise<void> => {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in required to resend verification.");
  try {
    await sendEmailVerification(user);
  } catch (error) {
    throw new Error(friendlyAuthError(error), { cause: error });
  }
};

export const signOut = async (): Promise<void> => {
  if (!isFirebaseConfigured()) return;
  await firebaseSignOut(getFirebaseAuth());
};

export const sendPasswordReset = async (email: string): Promise<void> => {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
  } catch (error) {
    // Generic success path is handled by UI; still avoid raw codes if surfaced.
    throw new Error(friendlyAuthError(error), { cause: error });
  }
};

export const getIdToken = async (forceRefresh = false): Promise<string | null> => {
  if (!isFirebaseConfigured()) return null;
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
};
