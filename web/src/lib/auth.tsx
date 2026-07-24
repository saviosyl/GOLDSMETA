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
  refreshAccount: () => Promise<AuthMeResponse | null>;
}

export type { AuthContextValue };

const AuthContext = createContext<AuthContextValue | null>(null);

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
      return null;
    }
    try {
      const me = await api.getAuthMe();
      setAccount(me);
      return me;
    } catch {
      setAccount(null);
      return null;
    }
  }, [api, user]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    return subscribeAuth((next) => {
      setUser(next);
      setLoading(false);
    });
  }, [configured]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

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
