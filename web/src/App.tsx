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
import { HomePage } from "./pages/HomePage";
import { ShortTermPage } from "./pages/ShortTermPage";
import { DayTradePage } from "./pages/DayTradePage";
import { HistoryHubPage } from "./pages/HistoryHubPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { SetupDetailPage } from "./pages/SetupDetailPage";
import { RiskPlannerPage } from "./pages/RiskPlannerPage";
import { AlertsSetupPage } from "./pages/AlertsSetupPage";
import { AdvancedHubPage } from "./pages/AdvancedHubPage";
import { UiReviewGate } from "./pages/UiReviewGate";
import { GoldHunterOverviewV2Page } from "./pages/goldHunter/GoldHunterOverviewV2Page";
import { GoldHunterTradesPage } from "./pages/goldHunter/GoldHunterTradesPage";

const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import("./pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const LearnPage = lazy(() => import("./pages/LearnPage").then((m) => ({ default: m.LearnPage })));
const ReplayPage = lazy(() => import("./pages/ReplayPage").then((m) => ({ default: m.ReplayPage })));
const V4ResearchPage = lazy(() => import("./pages/V4ResearchPage").then((m) => ({ default: m.V4ResearchPage })));
const MicroEdgePage = lazy(() => import("./pages/MicroEdgePage").then((m) => ({ default: m.MicroEdgePage })));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage").then((m) => ({ default: m.DiagnosticsPage })));
const SignalPerformancePage = lazy(() => import("./pages/SignalPerformancePage").then((m) => ({ default: m.SignalPerformancePage })));
const BrokerControlCentrePage = lazy(() => import("./pages/broker/BrokerControlCentrePage").then((m) => ({ default: m.BrokerControlCentrePage })));
const TradingViewSetupPage = lazy(() => import("./pages/TradingViewSetupPage").then((m) => ({ default: m.TradingViewSetupPage })));
const TradingViewTemplateAdminPage = lazy(() => import("./pages/admin/TradingViewTemplateAdminPage").then((m) => ({ default: m.TradingViewTemplateAdminPage })));
const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const GoldHunterShell = lazy(() => import("./pages/goldHunter/GoldHunterShell").then((m) => ({ default: m.GoldHunterShell })));
const GoldHunterControlPage = lazy(() => import("./pages/goldHunter/GoldHunterControlPage").then((m) => ({ default: m.GoldHunterControlPage })));
const GoldHunterPerformancePage = lazy(() => import("./pages/goldHunter/GoldHunterPerformancePage").then((m) => ({ default: m.GoldHunterPerformancePage })));

function RouteFallback({ label }: { label: string }) {
  return <div className="gm26-route-loading" role="status">Loading {label}…</div>;
}

function LazyRoute({ label, children }: { label: string; children: ReactNode }) {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <RouteErrorBoundary label={label} onRetry={() => setRetryKey((key) => key + 1)}>
      <Suspense key={retryKey} fallback={<RouteFallback label={label}>{}</RouteFallback> as never}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function PublicAuthRoutes() {
  return (
    <Routes>
      <Route path="/brand" element={<Navigate to="/" replace />} />
      <Route path="/ui-review/*" element={<UiReviewGate />} />
      <Route path="/register" element={<PublicPageShell testId="register-shell"><RegisterPage /></PublicPageShell>} />
      <Route path="/legal/terms" element={<PublicPageShell testId="legal-terms-shell"><TermsPage /></PublicPageShell>} />
      <Route path="/legal/privacy" element={<PublicPageShell testId="legal-privacy-shell"><PrivacyPage /></PublicPageShell>} />
      <Route path="/legal/risk" element={<PublicPageShell testId="legal-risk-shell"><RiskDisclosurePage /></PublicPageShell>} />
      <Route path="/registration-complete" element={<PublicPageShell testId="registration-complete-shell"><RegistrationCompletePage /></PublicPageShell>} />
      <Route path="/password-reset-sent" element={<PublicPageShell testId="password-reset-sent-shell"><PasswordResetSentPage /></PublicPageShell>} />
      <Route path="*" element={<PublicPageShell testId="signed-out-shell"><SignInPage /></PublicPageShell>} />
    </Routes>
  );
}

function ProtectedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <PublicPageShell testId="session-loading">
        <div className="gm26-session-loading"><img src="/brand/mark-official.png" alt="" width={48} height={48} /><p>Checking GoldMeta session…</p></div>
      </PublicPageShell>
    );
  }

  if (!user) return <PublicAuthRoutes />;

  return (
    <AccountAccessGate>
      <QuoteProvider>
        <LiveQuoteBridge />
        <AppShell>
          <Routes>
            <Route path="/brand" element={<Navigate to="/" replace />} />
            <Route path="/ui-review/*" element={<UiReviewGate />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/account-ready" element={<AccountReadyPage />} />
            <Route path="/awaiting-approval" element={<AwaitingApprovalPage />} />
            <Route path="/account-suspended" element={<AccountSuspendedPage />} />
            <Route path="/account/delete-request" element={<RequestDeletionPage />} />
            <Route path="/legal/terms" element={<TermsPage />} />
            <Route path="/legal/privacy" element={<PrivacyPage />} />
            <Route path="/legal/risk" element={<RiskDisclosurePage />} />

            <Route path="/" element={<HomePage />} />
            <Route path="/short-term" element={<ShortTermPage />} />
            <Route path="/day-trade" element={<DayTradePage />} />
            <Route path="/history" element={<HistoryHubPage />} />
            <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
            <Route path="/setups/:setupId" element={<SetupDetailPage />} />

            <Route path="/alerts" element={<AlertsSetupPage />} />
            <Route path="/planner" element={<RiskPlannerPage />} />
            <Route path="/brokers" element={<LazyRoute label="Connections"><BrokerControlCentrePage /></LazyRoute>} />
            <Route path="/settings" element={<LazyRoute label="Settings"><SettingsPage /></LazyRoute>} />
            <Route path="/help" element={<LazyRoute label="Help"><HelpPage /></LazyRoute>} />
            <Route path="/learn" element={<LazyRoute label="Learn"><LearnPage /></LazyRoute>} />
            <Route path="/learn/:lessonId" element={<LazyRoute label="Learn"><LearnPage /></LazyRoute>} />

            <Route path="/advanced" element={<AdvancedHubPage />} />
            <Route path="/advanced/research" element={<LazyRoute label="Research Lab"><V4ResearchPage /></LazyRoute>} />
            <Route path="/advanced/micro-edge" element={<LazyRoute label="Micro Edge"><MicroEdgePage /></LazyRoute>} />
            <Route path="/advanced/replay" element={<LazyRoute label="Replay"><ReplayPage /></LazyRoute>} />
            <Route path="/advanced/diagnostics" element={<LazyRoute label="Diagnostics"><DiagnosticsPage /></LazyRoute>} />
            <Route path="/advanced/tradingview" element={<LazyRoute label="TradingView Setup"><TradingViewSetupPage /></LazyRoute>} />
            <Route path="/advanced/analytics" element={<LazyRoute label="Signal Analytics"><SignalPerformancePage /></LazyRoute>} />
            <Route path="/admin/users" element={<LazyRoute label="Admin Users"><AdminUsersPage /></LazyRoute>} />
            <Route path="/admin/tradingview-template" element={<LazyRoute label="TradingView Template"><TradingViewTemplateAdminPage /></LazyRoute>} />

            <Route path="/gold-hunter" element={<LazyRoute label="Gold Hunter"><GoldHunterShell /></LazyRoute>}>
              <Route index element={<GoldHunterOverviewV2Page />} />
              <Route path="trades" element={<GoldHunterTradesPage />} />
              <Route path="performance" element={<LazyRoute label="Gold Hunter Performance"><GoldHunterPerformancePage /></LazyRoute>} />
              <Route path="control" element={<LazyRoute label="Gold Hunter Controls"><GoldHunterControlPage /></LazyRoute>} />
              <Route path="monitor" element={<Navigate to="/gold-hunter/trades" replace />} />
            </Route>

            <Route path="/analysis" element={<Navigate to="/" replace />} />
            <Route path="/intelligence" element={<Navigate to="/" replace />} />
            <Route path="/levels" element={<Navigate to="/" replace />} />
            <Route path="/journal" element={<Navigate to="/history" replace />} />
            <Route path="/history-replay" element={<Navigate to="/advanced/replay" replace />} />
            <Route path="/history-replay/:tab" element={<Navigate to="/advanced/replay" replace />} />
            <Route path="/history-replay/*" element={<Navigate to="/advanced/replay" replace />} />
            <Route path="/replay" element={<Navigate to="/advanced/replay" replace />} />
            <Route path="/insights" element={<Navigate to="/history" replace />} />
            <Route path="/insights/:tab" element={<Navigate to="/history" replace />} />
            <Route path="/insights/*" element={<Navigate to="/history" replace />} />
            <Route path="/signal-performance" element={<Navigate to="/advanced/analytics" replace />} />
            <Route path="/analytics" element={<Navigate to="/advanced/analytics" replace />} />
            <Route path="/analytics/v3" element={<Navigate to="/advanced/analytics" replace />} />
            <Route path="/v4" element={<Navigate to="/advanced/research" replace />} />
            <Route path="/micro-edge" element={<Navigate to="/advanced/micro-edge" replace />} />
            <Route path="/diagnostics" element={<Navigate to="/advanced/diagnostics" replace />} />
            <Route path="/tradingview" element={<Navigate to="/advanced/tradingview" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </QuoteProvider>
    </AccountAccessGate>
  );
}

export default function App() {
  return <AuthProvider><ProtectedApp /></AuthProvider>;
}
