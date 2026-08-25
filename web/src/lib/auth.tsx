import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { User } from "firebase/auth";
import { ApiClient } from "./api";
import {
  ensureAuthPersistence,
  getIdToken,
  isFirebaseConfigured,
  isPublicRegistrationEnabled,
  signIn as firebaseSignIn,
  signOut as firebaseSignOut,
  signUp as firebaseSignUp,
  subscribeAuth
} from "./firebase";
import { clearUserCaches } from "./offlineCache";
import { friendlyAuthError } from "./authErrors";

export type AccountAccess =
  | "APP"
  | "VERIFY_EMAIL"
  | "AWAITING_APPROVAL"
  | "SUSPENDED"
  | "FORBIDDEN"
  | "UNKNOWN";

export type AuthMeResponse = {
  uidMasked: string | null;
  role: string;
  approvalStatus: string;
  emailVerified: boolean;
  access: AccountAccess;
  profile: {
    firstName?: string;
    lastName?: string;
    email?: string;
    brokerAccess?: boolean;
    autoTrade?: boolean;
    brokerMessage?: string | null;
  } | null;
};

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  api: ApiClient;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  registrationEnabled: boolean;
  apiBaseUrl: string;
  account: AuthMeResponse | null;
  /** True while /auth/me is in flight for a signed-in user. */
  accountLoading: boolean;
  /** Friendly error when /auth/me failed durably (null when OK / idle). */
  accountError: string | null;
  /** True after /auth/me succeeds or fails (not mid-flight). */
  accountResolved: boolean;
  refreshAccount: () => Promise<AuthMeResponse | null>;
}

export type { AuthContextValue };

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCOUNT_LOOKUP_FAILED =
  "We could not verify your GoldMeta account right now. Check your connection and try again.";

const resolveApiBase = (): string => {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8080";
  return "";
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AuthMeResponse | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountResolved, setAccountResolved] = useState(false);
  const configured = isFirebaseConfigured();
  const apiBaseUrl = resolveApiBase();
  const registrationEnabled = isPublicRegistrationEnabled();

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiBaseUrl,
        getIdToken
      }),
    [apiBaseUrl]
  );

  const refreshAccount = useCallback(async () => {
    if (!user) {
      setAccount(null);
      setAccountError(null);
      setAccountLoading(false);
      setAccountResolved(true);
      return null;
    }
    setAccountLoading(true);
    setAccountError(null);
    try {
      const me = await api.getAuthMe();
      setAccount(me);
      setAccountError(null);
      setAccountResolved(true);
      return me;
    } catch (err) {
      setAccount(null);
      setAccountError(friendlyAuthError(err) || ACCOUNT_LOOKUP_FAILED);
      setAccountResolved(true);
      return null;
    } finally {
      setAccountLoading(false);
    }
  }, [api, user]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;
    // Keep loading=true until persistence is applied and the first auth event arrives.
    void ensureAuthPersistence()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        unsub = subscribeAuth((next) => {
          setUser(next);
          setLoading(false);
          if (!next) {
            setAccount(null);
            setAccountError(null);
            setAccountLoading(false);
            setAccountResolved(true);
          } else {
            // New signed-in user — require a fresh /me resolution.
            setAccountResolved(false);
            setAccountError(null);
          }
        });
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [configured]);

  useEffect(() => {
    if (!user) return;
    void refreshAccount();
  }, [user, refreshAccount]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      await firebaseSignIn(email, password);
    } catch (error) {
      throw new Error(friendlyAuthError(error), { cause: error });
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await firebaseSignUp(email, password);
  }, []);

  const signOut = useCallback(async () => {
    clearUserCaches();
    setAccount(null);
    setAccountError(null);
    setAccountLoading(false);
    setAccountResolved(true);
    await firebaseSignOut();
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      configured,
      api,
      signIn,
      signUp,
      signOut,
      registrationEnabled,
      apiBaseUrl,
      account,
      accountLoading,
      accountError,
      accountResolved,
      refreshAccount
    }),
    [
      user,
      loading,
      configured,
      api,
      signIn,
      signUp,
      signOut,
      registrationEnabled,
      apiBaseUrl,
      account,
      accountLoading,
      accountError,
      accountResolved,
      refreshAccount
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Preview-only auth override for `/ui-review` — no Firebase credentials. */
export function ReviewAuthProvider({
  value,
  children
}: {
  value: AuthContextValue;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
