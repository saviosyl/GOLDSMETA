import { Suspense, lazy, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { QuoteProvider } from "./lib/quoteContext";
import { LiveQuoteBridge } from "./components/LiveQuoteBridge";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { PublicPageShell } from "./components/layout/PublicPageShell";
import { AccountAccessGate } from "./components/AccountAccessGate";
import { SignInPage } from "./pages/SignInPage";
import { RegisterPage } from "./pages/RegisterPage";
import {
  AccountReadyPage,
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
import { KeyLevelsPage } from "./pages/KeyLevelsPage";
import { AlertsSetupPage } from "./pages/AlertsSetupPage";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { JournalPage } from "./pages/JournalPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SetupDetailPage } from "./pages/SetupDetailPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { BrandConceptsPage } from "./pages/BrandConceptsPage";
import { RiskPlannerPage } from "./pages/RiskPlannerPage";
import { UiReviewGate } from "./pages/UiReviewGate";

const IntelligencePage = lazy(() =>
  import("./pages/IntelligencePage").then((m) => ({ default: m.IntelligencePage }))
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
const LearnPage = lazy(() =>
  import("./pages/LearnPage").then((m) => ({ default: m.LearnPage }))
);
const InsightsPage = lazy(() =>
  import("./pages/InsightsPage").then((m) => ({ default: m.InsightsPage }))
);
const HistoryReplayPage = lazy(() =>
  import("./pages/HistoryReplayPage").then((m) => ({ default: m.HistoryReplayPage }))
);
const AutoTradePage = lazy(() =>
  import("./pages/AutoTradePage").then((m) => ({ default: m.AutoTradePage }))
);
const MicroEdgePage = lazy(() =>
  import("./pages/MicroEdgePage").then((m) => ({ default: m.MicroEdgePage }))
);
const MicroEdgeConnectCallbackPage = lazy(() =>
  import("./pages/MicroEdgeConnectCallbackPage").then((m) => ({
    default: m.MicroEdgeConnectCallbackPage
  }))
);
const BrokerControlCentrePage = lazy(() =>
  import("./pages/broker/BrokerControlCentrePage").then((m) => ({
    default: m.BrokerControlCentrePage
  }))
);
const TradingViewSetupPage = lazy(() =>
  import("./pages/TradingViewSetupPage").then((m) => ({ default: m.TradingViewSetupPage }))
);
const TradingViewTemplateAdminPage = lazy(() =>
  import("./pages/admin/TradingViewTemplateAdminPage").then((m) => ({
    default: m.TradingViewTemplateAdminPage
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
  const [retryKey, setRetryKey] = useState(0);
  return (
    <RouteErrorBoundary label={label} onRetry={() => setRetryKey((k) => k + 1)}>
      <Suspense key={retryKey} fallback={<RouteFallback label={label} />}>
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}

function PublicAuthRoutes() {
  return (
    <Routes>
      <Route
        path="/brand"
        element={
          <PublicPageShell testId="public-brand-shell">
            <div className="gm-main">
              <div className="gm-main-inner">
                <BrandConceptsPage />
              </div>
            </div>
          </PublicPageShell>
        }
      />
      <Route path="/ui-review/*" element={<UiReviewGate />} />
      <Route
        path="/register"
        element={
          <PublicPageShell testId="register-shell">
            <RegisterPage />
          </PublicPageShell>
        }
      />
      <Route
        path="/legal/terms"
        element={
          <PublicPageShell testId="legal-terms-shell">
            <TermsPage />
          </PublicPageShell>
        }
      />
      <Route
        path="/legal/privacy"
        element={
          <PublicPageShell testId="legal-privacy-shell">
            <PrivacyPage />
          </PublicPageShell>
        }
      />
      <Route
        path="/legal/risk"
        element={
          <PublicPageShell testId="legal-risk-shell">
            <RiskDisclosurePage />
          </PublicPageShell>
        }
      />
      <Route
        path="/registration-complete"
        element={
          <PublicPageShell testId="registration-complete-shell">
            <RegistrationCompletePage />
          </PublicPageShell>
        }
      />
      <Route
        path="/password-reset-sent"
        element={
          <PublicPageShell testId="password-reset-sent-shell">
            <PasswordResetSentPage />
          </PublicPageShell>
        }
      />
      <Route
        path="*"
        element={
          <PublicPageShell testId="signed-out-shell">
            <SignInPage />
          </PublicPageShell>
        }
      />
    </Routes>
  );
}

function ProtectedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <PublicPageShell testId="session-loading">
        <div className="gm-main">
          <div className="gm-main-inner">
            <div className="gm-section brand-loading" role="status">
              <img src="/brand/mark-official.png" alt="" width={48} height={48} />
              <p>Checking GoldMeta session…</p>
            </div>
          </div>
        </div>
      </PublicPageShell>
    );
  }

  if (!user) {
    return <PublicAuthRoutes />;
  }

  return (
    <AccountAccessGate>
      <QuoteProvider>
      <LiveQuoteBridge />
      <AppShell>
        <Routes>
          <Route path="/ui-review/*" element={<UiReviewGate />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/account-ready" element={<AccountReadyPage />} />
          <Route path="/awaiting-approval" element={<AwaitingApprovalPage />} />
          <Route path="/account-suspended" element={<AccountSuspendedPage />} />
          <Route path="/account/delete-request" element={<RequestDeletionPage />} />
          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/risk" element={<RiskDisclosurePage />} />
          <Route path="/" element={<OverviewPage />} />
          <Route path="/levels" element={<KeyLevelsPage />} />
          <Route path="/alerts" element={<AlertsSetupPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/history" element={<Navigate to="/history-replay/history" replace />} />
          <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
          <Route
            path="/signal-performance"
            element={<Navigate to="/insights/signals" replace />}
          />
          <Route path="/setups/:setupId" element={<SetupDetailPage />} />
          <Route path="/insights" element={<Navigate to="/insights/performance" replace />} />
          <Route
            path="/insights/:tab"
            element={
              <LazyRoute label="Insights">
                <InsightsPage />
              </LazyRoute>
            }
          />
          <Route
            path="/history-replay"
            element={<Navigate to="/history-replay/history" replace />}
          />
          <Route
            path="/history-replay/:tab"
            element={
              <LazyRoute label="History & Replay">
                <HistoryReplayPage />
              </LazyRoute>
            }
          />
          <Route
            path="/analytics"
            element={<Navigate to="/insights/strategy" replace />}
          />
          <Route path="/analytics/v3" element={<AnalyticsPage />} />
          <Route
            path="/intelligence"
            element={
              <LazyRoute label="Markets">
                <IntelligencePage />
              </LazyRoute>
            }
          />
          <Route
            path="/replay"
            element={<Navigate to="/history-replay/replay" replace />}
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
            path="/micro-edge"
            element={
              <LazyRoute label="Micro Edge">
                <MicroEdgePage />
              </LazyRoute>
            }
          />
          <Route
            path="/micro-edge/connect/callback"
            element={
              <LazyRoute label="Micro Edge Connect">
                <MicroEdgeConnectCallbackPage />
              </LazyRoute>
            }
          />
          <Route
            path="/autotrade/performance"
            element={<Navigate to="/insights/performance" replace />}
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
            path="/tradingview"
            element={
              <LazyRoute label="TradingView setup">
                <TradingViewSetupPage />
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
            path="/admin/tradingview-template"
            element={
              <LazyRoute label="TradingView template">
                <TradingViewTemplateAdminPage />
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
            path="/learn"
            element={
              <LazyRoute label="Learn">
                <LearnPage />
              </LazyRoute>
            }
          />
          <Route
            path="/learn/:lessonId"
            element={
              <LazyRoute label="Learn">
                <LearnPage />
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
      </QuoteProvider>
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
