import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { BottomNav } from "./components/BottomNav";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { SignInPage } from "./pages/SignInPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { JournalPage } from "./pages/JournalPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SetupDetailPage } from "./pages/SetupDetailPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";

const IntelligencePage = lazy(() =>
  import("./pages/IntelligencePage").then((m) => ({ default: m.IntelligencePage }))
);
const ReplayPage = lazy(() =>
  import("./pages/ReplayPage").then((m) => ({ default: m.ReplayPage }))
);
const PremiumAnalyticsPage = lazy(() =>
  import("./pages/PremiumAnalyticsPage").then((m) => ({ default: m.PremiumAnalyticsPage }))
);
const V4ResearchPage = lazy(() =>
  import("./pages/V4ResearchPage").then((m) => ({ default: m.V4ResearchPage }))
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);

function RouteFallback({ label }: { label: string }) {
  return (
    <div className="card" role="status" data-testid="route-loading">
      Loading {label}…
    </div>
  );
}

function LazyRoute({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <RouteErrorBoundary label={label}>
      <Suspense fallback={<RouteFallback label={label} />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function ProtectedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-shell auth-only">
        <div className="card" role="status">
          Checking session…
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell auth-only" data-testid="signed-out-shell">
        <h1 className="brand">GoldMeta</h1>
        <p className="subtitle">Sign in to load backend decisions</p>
        <SignInPage />
      </div>
    );
  }

  return (
    <div className="app-shell v5-shell">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
        <Route path="/setups/:setupId" element={<SetupDetailPage />} />
        <Route
          path="/analytics"
          element={
            <LazyRoute label="Analytics">
              <PremiumAnalyticsPage />
            </LazyRoute>
          }
        />
        <Route path="/analytics/v3" element={<AnalyticsPage />} />
        <Route
          path="/intelligence"
          element={
            <LazyRoute label="Intelligence">
              <IntelligencePage />
            </LazyRoute>
          }
        />
        <Route
          path="/replay"
          element={
            <LazyRoute label="Replay">
              <ReplayPage />
            </LazyRoute>
          }
        />
        <Route path="/diagnostics" element={<DiagnosticsPage />} />
        <Route
          path="/v4"
          element={
            <LazyRoute label="V4 Research">
              <V4ResearchPage />
            </LazyRoute>
          }
        />
        <Route path="/journal" element={<JournalPage />} />
        <Route
          path="/settings"
          element={
            <LazyRoute label="Settings">
              <SettingsPage />
            </LazyRoute>
          }
        />
        <Route
          path="*"
          element={
            <div className="card" data-testid="not-found">
              <h2 className="section-title">Page not found</h2>
              <p className="muted">That route is not part of GoldMeta.</p>
              <Navigate to="/" replace />
            </div>
          }
        />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ProtectedApp />
    </AuthProvider>
  );
}
