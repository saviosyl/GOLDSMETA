import { Link } from "react-router-dom";

export type OnboardingStep = {
  id: number;
  title: string;
  status: "Complete" | "Current" | "Locked" | "Action required";
  detail: string;
};

type Props = {
  steps: OnboardingStep[];
};

/**
 * Easy setup wizard for every verified active user (no admin approval for ordinary setup).
 */
export function AutoTradeOnboarding({ steps }: Props) {
  return (
    <section className="gm-at-onboarding" aria-labelledby="onboarding-heading">
      <div className="gm-at-onboarding-head">
        <h2 id="onboarding-heading" className="gm-section-title">
          Setup wizard
        </h2>
        <p className="gm-meta">
          Every verified GoldMeta user connects their own broker account. No shared owner account.
        </p>
      </div>
      <ol className="gm-at-journey-list" data-testid="autotrade-setup-journey">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`gm-at-step gm-at-step--${step.status.toLowerCase().replace(/\s+/g, "-")}`}
            data-testid={`autotrade-onboarding-step-${step.id}`}
          >
            <span className="gm-at-step-index">{step.id}</span>
            <div>
              <strong>{step.title}</strong>
              <em data-testid={`autotrade-step-${step.id}-status`}>{step.status}</em>
              <p className="gm-meta">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="gm-meta">
        Need help connecting? Open{" "}
        <Link to="/brokers" className="gm-btn-text">
          Broker Control Centre
        </Link>
        .
      </p>
    </section>
  );
}

export function buildOnboardingSteps(args: {
  emailVerified: boolean;
  connected: boolean;
  accountSelected: boolean;
  mode: "demo" | "live";
  goldOk: boolean;
  settingsSaved: boolean;
  checksOk: boolean;
  previewOk: boolean;
  tradingAuthorised: boolean;
  autoTradeOn: boolean;
}): OnboardingStep[] {
  const s = args;
  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: "Create account",
      status: "Complete",
      detail: "You are signed in to GoldMeta."
    },
    {
      id: 2,
      title: "Verify email",
      status: s.emailVerified ? "Complete" : "Action required",
      detail: s.emailVerified
        ? "Email verified."
        : "Verify your email to continue broker setup."
    },
    {
      id: 3,
      title: "Connect cTrader",
      status: !s.emailVerified ? "Locked" : s.connected ? "Complete" : "Current",
      detail: s.connected
        ? "Your cTrader OAuth connection is stored under your account."
        : "Connect your own cTrader account — tokens stay private to you."
    },
    {
      id: 4,
      title: "Choose broker account",
      status: !s.connected ? "Locked" : s.accountSelected ? "Complete" : "Current",
      detail: s.accountSelected
        ? "An authorised broker account is selected."
        : "Pick an account returned by cTrader — Demo or Live."
    },
    {
      id: 5,
      title: "Choose Demo or Live",
      status: !s.accountSelected ? "Locked" : "Complete",
      detail:
        s.mode === "live"
          ? "Live mode selected — real money confirmation required before enable."
          : "Demo mode selected — Demo funds only."
    },
    {
      id: 6,
      title: "Select Gold instrument",
      status: !s.accountSelected ? "Locked" : s.goldOk ? "Complete" : "Current",
      detail: s.goldOk ? "Gold symbol resolved." : "Confirm XAUUSD / GOLD on your account."
    },
    {
      id: 7,
      title: "Configure risk and AutoTrade",
      status: !s.goldOk ? "Locked" : s.settingsSaved ? "Complete" : "Current",
      detail: "Set risk, lot sizing, daily limits and signal filters for this mode."
    },
    {
      id: 8,
      title: "Run connection checks",
      status: !s.settingsSaved ? "Locked" : s.checksOk ? "Complete" : "Current",
      detail: "Confirm quotes, spread and market status (read-only)."
    },
    {
      id: 9,
      title: "Preview a trade",
      status: !s.checksOk ? "Locked" : s.previewOk ? "Complete" : "Current",
      detail: "Preview BUY / SELL / WAIT sizing — no order is submitted in this phase."
    },
    {
      id: 10,
      title: "Authorise trading",
      status: "Locked",
      detail: "Trading authorisation stays locked while order submission is disabled."
    },
    {
      id: 11,
      title: "Enable AutoTrade",
      status: s.autoTradeOn ? "Complete" : "Locked",
      detail: "AutoTrade remains OFF until a later approved execution phase."
    }
  ];

  let sawOpen = false;
  return steps.map((step) => {
    if (step.status === "Complete" || step.status === "Locked") return step;
    if (!sawOpen) {
      sawOpen = true;
      return { ...step, status: step.status === "Action required" ? "Action required" : "Current" };
    }
    return { ...step, status: "Locked" };
  });
}
