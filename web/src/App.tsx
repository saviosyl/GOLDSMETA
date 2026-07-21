import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { BottomNav } from "./components/BottomNav";
import { SignInPage } from "./pages/SignInPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { JournalPage } from "./pages/JournalPage";
import { SettingsPage } from "./pages/SettingsPage";

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
      <div className="app-shell auth-only">
        <h1 className="brand">GoldMeta</h1>
        <p className="subtitle">Sign in to load backend decisions</p>
        <SignInPage />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:decisionId" element={<HistoryDetailPage />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
