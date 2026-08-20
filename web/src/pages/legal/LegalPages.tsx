/** Lightweight legal pages for registration consent (not legal advice). */

export function TermsPage() {
  return (
    <div className="gm-auth-layout" data-testid="legal-terms">
      <div className="gm-auth-card gm-auth-card-wide">
        <h1 className="gm-auth-title">Terms of Service</h1>
        <p className="gm-auth-support">Version 2026-07-24</p>
        <p className="gm-meta">
          GoldMeta provides market analysis tools only. Creating an account does not enable broker
          trading, Gold Hunter Demo, Demo order submission, or Live order submission. You remain
          responsible for your own trading decisions. GoldMeta is not an investment adviser and does
          not claim regulatory approval for brokerage services.
        </p>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="gm-auth-layout" data-testid="legal-privacy">
      <div className="gm-auth-card gm-auth-card-wide">
        <h1 className="gm-auth-title">Privacy Policy</h1>
        <p className="gm-auth-support">Version 2026-07-24</p>
        <p className="gm-meta">
          We store your name, email, country of residence, policy acceptance timestamps and versions,
          and account role status to operate the service. We do not store passwords in Firestore. We
          do not sell your personal data. Contact support to request account deletion.
        </p>
      </div>
    </div>
  );
}

export function RiskDisclosurePage() {
  return (
    <div className="gm-auth-layout" data-testid="legal-risk">
      <div className="gm-auth-card gm-auth-card-wide">
        <h1 className="gm-auth-title">CFD / high-risk disclosure</h1>
        <p className="gm-auth-support">Version 2026-07-24</p>
        <p className="gm-meta">
          Contracts for difference (CFDs) and leveraged products are complex and carry a high risk of
          losing money rapidly due to leverage. Financial results are not guaranteed. Registration
          does not enable trading. Demo and Live trading remain separate and disabled by default.
        </p>
      </div>
    </div>
  );
}

export function RequestDeletionPage() {
  return (
    <div className="gm-section" data-testid="request-deletion-page">
      <h2 className="gm-section-title">Request account deletion</h2>
      <p className="gm-meta">
        To request deletion of your GoldMeta account and associated personal data, email support at
        the address listed in Settings and include the email used for registration. Deletion requests
        are reviewed manually. TradingView webhooks and broker credentials belonging to other users
        are never transferred.
      </p>
      <p className="gm-meta">
        Pending and suspended accounts may request deletion. Owner accounts follow a separate
        break-glass process and are not deleted through this form.
      </p>
    </div>
  );
}
