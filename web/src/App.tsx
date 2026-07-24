import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { AccountAccessGate } from "./components/AccountAccessGate";
import { SignInPage } from "./pages/SignInPage";
import { RegisterPage } from "./pages/RegisterPage";
import {
  AccountSuspendedPage,
  AwaitingApprovalPage,
  PasswordResetSentPage,
  RegistrationCompletePage,
  VerifyEmailPage
} from "./pages/auth/StatusPages";
import {
  PrivacyPage,
  RequestDeletionPage,
  RiskDisclosurePage,
  TermsPage
} from "./pages/legal/LegalPages";
import { OverviewPage } from "./pages/OverviewPage";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { SignalPerformancePage } from "./pages/SignalPerformancePage";
import { JournalPage } from "./pages/JournalPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SetupDetailPage } from "./pages/SetupDetailPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { BrandConceptsPage } from "./pages/BrandConceptsPage";
import { RiskPlannerPage } from "./pages/RiskPlannerPage";
import { UiReviewGate } from "./pages/UiReviewApp";

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
const HelpPage = lazy(() =>
  import("./pages/HelpPage").then((m) => ({ default: m.HelpPage }))
);
const AutoTradePage = lazy(() =>
  import("./pages/AutoTradePage").then((m) => ({ default: m.AutoTradePage }))
);
const BrokerControlCentrePage = lazy(() =>
  import("./pages/broker/BrokerControlCentrePage").then((m) => ({
    default: m.BrokerControlCentrePage
  }))
);
const AdminUsersPage = lazy(() =>
  import("./pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage }))
);

function RouteFallback({ label }: { label: string }) {
  return (
    <div className="gm-section" role="status" data-testid="route-loading">
      Loading {label}…
    </div>
  );
}

function LazyRoute({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RouteErrorBoundary label={label}>
      <Suspense fallback={<RouteFallback label={label} />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function PublicAuthRoutes() {
  return (
    <Routes>
      <Route
        path="/brand"
        element={
          <div className="gm-shell" data-testid="public-brand-shell">
            <div className="gm-main">
              <div className="gm-main-inner">
                <BrandConceptsPage />
              </div>
            </div>
          </div>
        }
      />
      <Route path="/ui-review/*" element={<UiReviewGate />} />
      <Route
        path="/register"
        element={
          <div className="gm-shell" data-testid="register-shell">
            <RegisterPage />
          </div>
        }
      />
      <Route path="/legal/terms" element={<div className="gm-shell"><TermsPage /></div>} />
      <Route path="/legal/privacy" element={<div className="gm-shell"><PrivacyPage /></div>} />
      <Route path="/legal/risk" element={<div className="gm-shell"><RiskDisclosurePage /></div>} />
      <Route
        path="/registration-complete"
        element={
          <div className="gm-shell">
            <RegistrationCompletePage />
          </div>
        }
      />
      <Route
        path="/password-reset-sent"
        element={
          <div className="gm-shell">
            <PasswordResetSentPage />
          </div>
        }
      />
      <Route
        path="*"
        element={
          <div className="gm-shell" data-testid="signed-out-shell">
            <SignInPage />
          </div>
        }
      />
    </Routes>
  );
}

function ProtectedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="gm-shell" data-testid="session-loading">
        <div className="gm-main">
          <div className="gm-main-inner">
            <div className="gm-section brand-loading" role="status">
              <img src="/brand/mark-official.png" alt="" width={48} height={48} />
              <p>Checking GoldMeta session…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <PublicAuthRoutes />;
  }

  return (
    <AccountAccessGate>
      <AppShell>
        <Routes>
          <Route path="/ui-review/*" element={<UiReviewGate />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/awaiting-approval" element={<AwaitingApprovalPage />} />
          <Route path="/account-suspended" element={<AccountSuspendedPage />} />
          <Route path="/account/delete-request" element={<RequestDeletionPage />} />
          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/risk" element={<RiskDisclosurePage />} />
          <Route path="/" element={<OverviewPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
          <Route path="/signal-performance" element={<SignalPerformancePage />} />
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
          <Route path="/brand" element={<BrandConceptsPage />} />
          <Route path="/planner" element={<RiskPlannerPage />} />
          <Route
            path="/autotrade"
            element={
              <LazyRoute label="AutoTrade">
                <AutoTradePage />
              </LazyRoute>
            }
          />
          <Route
            path="/brokers"
            element={
              <LazyRoute label="Brokers">
                <BrokerControlCentrePage />
              </LazyRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <LazyRoute label="Admin users">
                <AdminUsersPage />
              </LazyRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <LazyRoute label="Settings">
                <SettingsPage />
              </LazyRoute>
            }
          />
          <Route
            path="/help"
            element={
              <LazyRoute label="Help">
                <HelpPage />
              </LazyRoute>
            }
          />
          <Route
            path="*"
            element={
              <div className="gm-section" data-testid="not-found">
                <h2 className="gm-section-title">Page not found</h2>
                <p className="gm-meta">That page is not part of GoldMeta.</p>
                <Navigate to="/" replace />
              </div>
            }
          />
        </Routes>
      </AppShell>
    </AccountAccessGate>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ProtectedApp />
    </AuthProvider>
  );
}
