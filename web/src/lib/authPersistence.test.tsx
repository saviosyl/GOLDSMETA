import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const setPersistence = vi.fn(() => Promise.resolve());
const onAuthStateChanged = vi.fn((_auth: unknown, cb: (u: null) => void) => {
  queueMicrotask(() => cb(null));
  return () => undefined;
});

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({ name: "test-app" }))
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({ app: { name: "test-app" } })),
  onAuthStateChanged: (auth: unknown, cb: (u: null) => void) => onAuthStateChanged(auth, cb),
  setPersistence: (...args: unknown[]) => setPersistence(...args),
  browserLocalPersistence: { type: "LOCAL" },
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signOut: vi.fn()
}));

vi.mock("./api", () => ({
  ApiClient: class {
    getAuthMe = async () => null;
  }
}));

describe("auth persistence + loading gate", () => {
  beforeEach(() => {
    setPersistence.mockClear();
    onAuthStateChanged.mockClear();
    vi.resetModules();
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-key");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "example.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "goldmeta-prod-example");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "app-id");
  });

  it("applies browserLocalPersistence without changing project id", async () => {
    const firebase = await import("./firebase");
    expect(firebase.getFirebaseProjectId()).toBe("goldmeta-prod-example");
    await firebase.ensureAuthPersistence();
    expect(setPersistence).toHaveBeenCalled();
    const persistenceArg = setPersistence.mock.calls[0]?.[1] as { type?: string };
    expect(persistenceArg?.type).toBe("LOCAL");
  });

  it("AuthProvider clears loading after first auth event", async () => {
    const { AuthProvider, useAuth } = await import("./auth");
    function Probe() {
      const { loading } = useAuth();
      return (
        <div data-testid="auth-probe" data-loading={loading ? "1" : "0"}>
          {loading ? "loading" : "ready"}
        </div>
      );
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("auth-probe")).toHaveAttribute("data-loading", "0");
    });
    expect(screen.getByTestId("auth-probe")).toHaveTextContent("ready");
    expect(onAuthStateChanged).toHaveBeenCalled();
    expect(setPersistence).toHaveBeenCalled();
  });
});
