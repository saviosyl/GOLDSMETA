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
  signIn as firebaseSignIn,
  signOut as firebaseSignOut,
  signUp as firebaseSignUp,
  subscribeAuth
} from "./firebase";
import { clearUserCaches } from "./offlineCache";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  api: ApiClient;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  apiBaseUrl: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const resolveApiBase = (): string => {
  // production API base resolved from VITE_API_BASE_URL at build time

  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  // Local dev convenience only — never bake localhost into production builds.
  if (import.meta.env.DEV) return "http://127.0.0.1:8080";
  return "";
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isFirebaseConfigured();
  const apiBaseUrl = resolveApiBase();

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

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiBaseUrl,
        getIdToken
      }),
    [apiBaseUrl]
  );

  const signIn = useCallback(async (email: string, password: string) => {
    await firebaseSignIn(email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await firebaseSignUp(email, password);
  }, []);

  const signOut = useCallback(async () => {
    clearUserCaches();
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
      apiBaseUrl
    }),
    [user, loading, configured, api, signIn, signUp, signOut, apiBaseUrl]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
