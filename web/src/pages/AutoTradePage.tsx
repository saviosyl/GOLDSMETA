import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Shield,
  Scale,
  Bot,
  AlertTriangle,
  BarChart3,
  Lock,
  CheckCircle2,
  Circle
} from "lucide-react";
import { useAuth } from "../lib/auth";
import type {
  AutoTradeStatus,
  SelectedBrokerId,
  T212InstrumentCandidate
} from "../lib/autoTradeTypes";
import {
  FIRST_PILOT_LIMITS_CLIENT,
  T212_PROXY_DISCLAIMER_CLIENT
} from "../lib/autoTradeTypes";
import type {
  BrokerControlCentreResponse,
  CTraderBrokerAccountOption,
  CTraderDiagnosticsReport,
  UserAutoTradeSettingsDto
} from "../lib/broker/ctraderTypes";
import {
  AutoTradeOnboarding,
  buildOnboardingSteps
} from "../components/autotrade/AutoTradeOnboarding";
import { LiveActivationConfirm } from "../components/autotrade/LiveActivationConfirm";
import {
  friendlyBrokerReason,
  friendlyPreviewNote
} from "../lib/brokerFriendlyCopy";
import { ExecutionDisabledBanner } from "../components/ExecutionDisabledBanner";
import { PremiumStatusChip } from "../components/broker/PremiumStatusChip";
import {
  buildAutoTradeActivityFeed,
  deriveAutoTradeSyncSummary
} from "../lib/broker/autoTradeSyncState";
import { friendlyApiCode } from "../lib/plainLanguage";
import { friendlyActivityMessage } from "../lib/friendlyActivityCopy";
import { useShellQuote } from "../lib/quoteContext";
import { QualificationDashboard } from "../components/autotrade/QualificationDashboard";
import { DailySafetyCard } from "../components/autotrade/DailySafetyCard";
import type { QualificationPublicView } from "../lib/broker/qualificationTypes";
import type { DailySafetyPublicView } from "../lib/broker/ctraderTypes";

const MODE_STORAGE_KEY = "gm-autotrade-mode-tab";

function money(n: number | null | undefined, currency = "EUR"): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(n);
}

function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function statusTone(status: string): string {
  switch (status) {
    case "OFF":
      return "gm-at-pill--off";
    case "SHADOW":
      return "gm-at-pill--shadow";
    case "DEMO":
      return "gm-at-pill--demo";
    case "LIVE":
      return "gm-at-pill--live";
    case "LOCKED":
      return "gm-at-pill--locked";
    default:
      return "gm-at-pill--off";
  }
}

type ModeTab = "demo" | "live";

export function AutoTradePage() {
  const { api, account } = useAuth();
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [centre, setCentre] = useState<BrokerControlCentreResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<CTraderDiagnosticsReport | null>(null);
  const [accounts, setAccounts] = useState<CTraderBrokerAccountOption[]>([]);
  const [settings, setSettings] = useState<UserAutoTradeSettingsDto | null>(null);
  const [recommended, setRecommended] = useState<Record<string, unknown> | null>(null);
  const [mode, setMode] = useState<ModeTab>(() => {
    try {
      return sessionStorage.getItem(MODE_STORAGE_KEY) === "live" ? "live" : "demo";
    } catch {
      return "demo";
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [stalePrompt, setStalePrompt] = useState(false);
  const [riskStyle, setRiskStyle] = useState<"fixed" | "percentage">("fixed");
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showT212, setShowT212] = useState(false);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [previewOk, setPreviewOk] = useState(false);
  const [pendingLiveAccountId, setPendingLiveAccountId] = useState<string | null>(null);
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  const [qualification, setQualification] = useState<QualificationPublicView | null>(null);
  const [qualificationError, setQualificationError] = useState<string | null>(null);
  const [qualificationLoading, setQualificationLoading] = useState(true);
  const [dailySafety, setDailySafety] = useState<DailySafetyPublicView | null>(null);
  const reloadGenRef = useRef(0);
  const shellQuote = useShellQuote().quote;

  useEffect(() => {
    try {
      sessionStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  useEffect(() => {
    const loadedAt = Date.now();
    const onVis = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt > 5 * 60_000) {
        setStalePrompt(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const reload = useCallback(async () => {
    // Mirror Broker Control Centre: paint from control-centre + accounts + qualification
    // first. Diagnostics is optional enrichment and must NEVER block connection/qualification UI
    // (Cloud Functions gateway can 504 buildDiagnostics while Broker still shows CONNECTED).
    const gen = ++reloadGenRef.current;
    setQualificationLoading(true);
    try {
      const next = await api.autoTradeStatus();
      if (gen !== reloadGenRef.current) return;
      setStatus(next);
      setError(null);
    } catch (err) {
      if (gen !== reloadGenRef.current) return;
      const msg = err instanceof Error ? err.message : "Unable to load AutoTrade status";
      const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code ?? "") : "";
      setError(code ? friendlyApiCode(code, msg).message : friendlyBrokerReason(msg, msg));
    }

    const [centreResult, accountsResult, qualResult, dailyResult] = await Promise.allSettled([
      api.getBrokerControlCentre(),
      api.listCTraderAccounts(),
      api.getAutoTradeQualification(),
      api.getDailySafety(mode === "live" ? "live" : "demo")
    ]);
    if (gen !== reloadGenRef.current) return;

    if (centreResult.status === "fulfilled") {
      setCentre(centreResult.value);
    }
    if (accountsResult.status === "fulfilled") {
      setAccounts(accountsResult.value.accounts ?? []);
    }
    if (dailyResult.status === "fulfilled") {
      setDailySafety(dailyResult.value);
    }
    if (qualResult.status === "fulfilled") {
      setQualification(qualResult.value);
      setQualificationError(null);
    } else {
      const reason =
        qualResult.reason instanceof Error
          ? qualResult.reason.message
          : "Unable to load qualification status";
      const code =
        typeof qualResult.reason === "object" &&
        qualResult.reason &&
        "code" in qualResult.reason
          ? String((qualResult.reason as { code?: string }).code ?? "")
          : "";
      // Safe diagnostic only — never tokens / account numbers beyond already-masked UI state.
      console.warn("[AutoTrade] qualification load failed", {
        code: code || undefined,
        message: reason
      });
      setQualificationError(
        code ? friendlyApiCode(code, reason).message : friendlyBrokerReason(reason, reason)
      );
    }
    setQualificationLoading(false);

    // Optional diagnostics — apply only if this reload generation is still current.
    void (async () => {
      try {
        const d = await api.getCTraderDiagnostics();
        if (gen !== reloadGenRef.current) return;
        setDiagnostics(d);
        if (d.selectedAccountIsLive || d.environment === "LIVE") setMode("live");
        else if (d.demoAccountSelected || d.accountSelected) setMode("demo");
      } catch {
        // Keep prior diagnostics — do not wipe a Broker-selected account.
      }
    })();
  }, [api, mode]);

  const loadSettings = useCallback(
    async (env: ModeTab) => {
      try {
        const res = await api.getAutoTradeSettings(env);
        setSettings(res.settings);
        setRecommended(res.recommended ?? null);
        // Settings document exists for this mode — wizard step 7 can advance.
        setSettingsSaved(true);
      } catch {
        setSettings(null);
      }
    },
    [api]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Re-fetch canonical server state whenever AutoTrade becomes visible again
  // (Broker → AutoTrade navigation / tab return) without requiring a full restart.
  useEffect(() => {
    const onFocus = () => {
      void reload();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void reload();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reload]);

  useEffect(() => {
    void loadSettings(mode);
  }, [loadSettings, mode]);

  const run = async (fn: () => Promise<AutoTradeStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setStatus(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setError(friendlyBrokerReason(msg, msg));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const selectedBroker: SelectedBrokerId = status?.selectedBroker ?? "PEPPERSTONE_CTRADER";
  const limits = status?.limits ?? FIRST_PILOT_LIMITS_CLIENT;
  const budget = status?.budget;
  const connection = status?.connection;
  const t212 = status?.t212;
  const display = status?.displayStatus ?? "OFF";
  const proposal = status?.t212PendingProposal;
  const candidates = status?.t212GoldCandidates ?? [];

  const sync = useMemo(
    () =>
      deriveAutoTradeSyncSummary({
        mode,
        centre,
        diagnostics,
        accounts,
        settings
      }),
    [mode, centre, diagnostics, accounts, settings]
  );

  const connectionLabel = sync.connectionLabel;
  const autoTradeLabel = "OFF";
  const marketOpen = sync.marketOpen;
  const marketLabel = sync.marketLabel;
  const accountLabel = sync.accountLabel;
  const modeLabel = sync.modeLabel;
  const fundsLabel = sync.fundsLabel;

  const tradingAuthorised = Boolean(
    diagnostics?.connection?.oauthScope === "trading" ||
      qualification?.blockers?.some((b) => b.id === "trading_scope" && b.ok)
  );

  const onboarding = useMemo(
    () =>
      buildOnboardingSteps({
        emailVerified: account?.emailVerified !== false,
        connected: sync.connected,
        accountSelected: sync.accountSelected,
        mode,
        goldOk: sync.goldOk,
        settingsSaved,
        checksOk: sync.checksOk,
        previewOk,
        tradingAuthorised,
        autoTradeOn: false
      }),
    [
      account?.emailVerified,
      sync.connected,
      sync.accountSelected,
      sync.goldOk,
      sync.checksOk,
      mode,
      settingsSaved,
      previewOk,
      tradingAuthorised
    ]
  );

  const activityFeed = useMemo(
    () =>
      buildAutoTradeActivityFeed({
        activity: status?.activity ?? [],
        summary: sync
      }).map((item) => ({
        ...item,
        message: friendlyActivityMessage(item.message)
      })),
    [status?.activity, sync]
  );

  const selectBroker = (broker: SelectedBrokerId) => {
    if (broker === selectedBroker) return;
    if (broker === "IG_DEMO") return;
    void run(() => api.autoTradeSelectBroker(broker));
  };

  const searchInstruments = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.autoTradeT212SearchInstruments(
        instrumentQuery.trim() || undefined
      );
      setStatus(result.status);
      setShowInstrumentPicker(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Instrument search failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmInstrument = async (candidate: T212InstrumentCandidate) => {
    await run(() =>
      api.autoTradeT212ConfirmInstrument({
        instrumentId: candidate.instrumentId,
        ticker: candidate.ticker,
        name: candidate.name,
        currency: candidate.currency ?? "EUR",
        isin: candidate.isin,
        exchange: candidate.exchange,
        fractionalSupported: candidate.fractionalSupported,
        minOrderQuantity: candidate.minOrderQuantity,
        minOrderValue: candidate.minOrderValue
      })
    );
    setShowInstrumentPicker(false);
  };

  const selectAccount = async (acct: CTraderBrokerAccountOption) => {
    setBusy(true);
    setError(null);
    try {
      if (acct.isLive) {
        setMode("live");
        setPendingLiveAccountId(acct.ctidTraderAccountId);
        setShowLiveConfirm(true);
        return;
      }
      await api.selectCTraderAccount({
        ctidTraderAccountId: acct.ctidTraderAccountId,
        confirmPepperstone: true,
        confirmLiveSelection: false
      });
      setMode("demo");
      await reload();
      await loadSettings("demo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not select account");
    } finally {
      setBusy(false);
    }
  };

  const confirmLiveAccount = async (phrase: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.confirmLiveAutoTradeActivation(phrase);
      const targetId =
        pendingLiveAccountId ??
        accounts.find((a) => a.isLive && a.selected)?.ctidTraderAccountId ??
        accounts.find((a) => a.isLive)?.ctidTraderAccountId;
      if (!targetId) throw new Error("No Live account available");
      await api.selectCTraderAccount({
        ctidTraderAccountId: targetId,
        confirmPepperstone: true,
        confirmLiveSelection: true
      });
      setShowLiveConfirm(false);
      setPendingLiveAccountId(null);
      setMode("live");
      await reload();
      await loadSettings("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live confirmation failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSettingsPatch = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveAutoTradeSettings(mode, patch);
      setSettings(res.settings);
      setSettingsSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setPreviewNote(null);
    try {
      const result = (await api.createCTraderPreview({
        decision: "BUY",
        confidence: settings?.minConfidence ?? 85
      })) as { notice?: string; preview?: { action?: string; state?: string } };
      const action = result.preview?.action?.replace(/_/g, " ") ?? "—";
      const state = result.preview?.state?.replace(/_/g, " ") ?? "—";
      setPreviewNote(
        friendlyPreviewNote(
          result.notice ??
            `Preview ${action} · ${state}. Order submission is currently disabled in this preview.`
        )
      );
      setPreviewOk(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Preview failed";
      setError(friendlyBrokerReason(msg, msg));
    } finally {
      setBusy(false);
    }
  };

  const emergencyStop = async () => {
    setBusy(true);
    try {
      await api.setCTraderEmergencyStop({ environment: mode, active: true });
      await run(() => api.autoTradeEmergencyStop());
    } finally {
      setBusy(false);
    }
  };

  const demoAccount = diagnostics?.account;
  const quote = diagnostics?.quote;
  const position = status?.positions?.[0] ?? null;
  const currency =
    demoAccount?.currency ??
    diagnostics?.connection?.currency ??
    connection?.currency ??
    budget?.currency ??
    "EUR";

  const filteredAccounts = accounts.filter((a) => (mode === "live" ? a.isLive : !a.isLive));

  const isLiveEnv =
    Boolean(diagnostics?.selectedAccountIsLive) ||
    diagnostics?.environment === "LIVE" ||
    mode === "live";
  const maskedAt =
    sync.accountMasked ??
    diagnostics?.account?.accountIdMasked ??
    diagnostics?.connection?.accountMasked ??
    null;
  const equityAt =
    diagnostics?.account?.equity ?? diagnostics?.account?.balance ?? null;
  const fundedAt = equityAt != null && equityAt > 0;
  // Align with Broker diagnostics: closed-market previous-session quotes still count as healthy.
  const brokerQuoteHealthy = Boolean(
    diagnostics?.liveQuoteReceived ||
      (diagnostics?.quote?.bid != null && diagnostics?.quote?.ask != null) ||
      centre?.readiness?.connectionSummary?.lastQuoteAt ||
      sync.bid != null
  );
  const brokerQuoteLive =
    brokerQuoteHealthy &&
    Boolean(diagnostics?.liveQuoteReceived) &&
    !diagnostics?.quote?.stale &&
    diagnostics?.quote?.bid != null &&
    (diagnostics?.quote?.marketStatus || "").toUpperCase().includes("OPEN");
  const marketDataConnected = Boolean(
    (shellQuote && !shellQuote.unavailable && shellQuote.price != null) ||
      sync.marketStatusRaw ||
      sync.bid != null ||
      sync.checksOk ||
      centre?.readiness?.connectionSummary?.symbolName
  );
  const marketDataLabel = !marketDataConnected
    ? "Waiting"
    : sync.marketOpen || shellQuote?.marketStatus === "OPEN"
      ? "Connected"
      : shellQuote?.marketStatus === "CLOSED" ||
          /CLOSE/i.test(sync.marketStatusRaw || "")
        ? "Connected · Market closed"
        : "Connected";
  const brokerConnected =
    sync.connected ||
    Boolean(centre?.readiness?.connected) ||
    Boolean(diagnostics?.oauthConnected) ||
    Boolean(qualification?.accountIdPresent && qualification.accountMasked) ||
    Boolean(accounts.some((a) => a.selected));
  const heroState = isLiveEnv
    ? "SHADOW"
    : display === "SHADOW"
      ? "SHADOW"
      : "OFF";

  return (
    <div
      className="gm-autotrade gm-at-dashboard gm-prem-page"
      data-testid="autotrade-page"
    >
      <header className="gm-prem-page-head">
        <div>
          <h1>AutoTrade Control</h1>
          <p>Status, readiness, and safeguards</p>
        </div>
        <div className="gm-prem-chip-row">
          <PremiumStatusChip
            tone={heroState === "SHADOW" ? "amber" : "off"}
            withDot
          >
            {heroState === "SHADOW" ? "SHADOW MODE" : "OFF"}
          </PremiumStatusChip>
          <span className="gm-prem-updated" aria-live="polite">
            <span className="gm-prem-dot" aria-hidden="true" />
            {marketLabel || "Waiting for data"}
          </span>
        </div>
      </header>

      <ExecutionDisabledBanner page="autotrade" />

      <div
        className={`gm-prem-card gm-env-banner ${isLiveEnv ? "gm-env-banner--live" : "gm-env-banner--demo"}`}
        data-testid="autotrade-env-banner"
      >
        <strong>{isLiveEnv ? "LIVE · REAL MONEY" : "DEMO · DEMO FUNDS"}</strong>
        <span>
          {maskedAt || qualification?.accountMasked
            ? `Account ${maskedAt || qualification?.accountMasked}`
            : "No account selected"}{" "}
          · AutoTrade {display === "OFF" || !status?.mode ? "OFF" : autoTradeLabel} · Live orders
          LOCKED
        </span>
      </div>

      <section className="gm-prem-card gm-prem-card--navy gm-at-control-strip" aria-label="Execution status">
        <div className="gm-prem-hero-top">
          <div>
            <p className="gm-prem-card__title">AutoTrade Control</p>
            <h2 className="gm-prem-card__headline">
              {heroState === "SHADOW" ? "SHADOW / OFF" : "OFF"}
            </h2>
            <p className="gm-prem-card__sub">
              {heroState === "SHADOW"
                ? "Live ideas are simulated. No orders sent."
                : "Automation is off. Live execution stays locked."}
            </p>
          </div>
          <PremiumStatusChip tone="locked" withDot>
            LOCKED
          </PremiumStatusChip>
        </div>
        <div className="gm-prem-stat-grid gm-prem-stat-grid--3">
          <div className="gm-prem-stat" data-testid="autotrade-broker-account-stat">
            <span>Broker account</span>
            <strong>
              {maskedAt || qualification?.accountMasked
                ? `${sync.isLive ? "LIVE" : "Demo"} · ${maskedAt || qualification?.accountMasked}`
                : brokerConnected
                  ? "Connected · select account"
                  : "Not connected"}
            </strong>
            <em className="gm-prem-stat-note">
              {brokerConnected && (sync.accountSelected || qualification?.accountIdPresent)
                ? "Connected"
                : sync.connectionLabel}
            </em>
          </div>
          <div className="gm-prem-stat">
            <span>AutoTrade</span>
            <strong>{display === "OFF" || !status?.mode ? "OFF" : autoTradeLabel}</strong>
          </div>
          <div className="gm-prem-stat">
            <span>Live orders</span>
            <strong className="is-lock">LOCKED</strong>
          </div>
          <div className="gm-prem-stat" data-testid="autotrade-market-data-stat">
            <span>Market data</span>
            <strong className={marketDataConnected ? "is-ok" : "is-warn"}>
              {marketDataLabel}
            </strong>
          </div>
          <div className="gm-prem-stat" data-testid="autotrade-broker-quotes-stat">
            <span>Personal broker quotes</span>
            <strong className={brokerQuoteHealthy ? "is-ok" : "is-warn"}>
              {brokerQuoteLive
                ? "Live"
                : brokerQuoteHealthy
                  ? "Active"
                  : brokerConnected
                    ? "Waiting"
                    : "Unavailable"}
            </strong>
          </div>
          <div className="gm-prem-stat" data-testid="autotrade-live-execution-stat">
            <span>Live execution account</span>
            <strong className="is-lock">
              {sync.isLive && sync.accountSelected ? `${maskedAt ?? "Selected"} · Locked` : "Not selected"}
            </strong>
          </div>
        </div>
        {/* Preserve broker badge test id */}
        <p className="gm-prem-sr-status" data-testid="autotrade-broker-badge">
          {accountLabel}
        </p>
      </section>

      {dailySafety ? (
        <DailySafetyCard
          safety={dailySafety}
          busy={busy}
          onResume={() => {
            void (async () => {
              setBusy(true);
              try {
                setDailySafety(await api.resumeDailySafety(mode === "live" ? "live" : "demo"));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not resume");
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      ) : null}

      {qualification ? (
        <QualificationDashboard
          view={qualification}
          busy={busy}
          onStart={() => {
            void (async () => {
              setBusy(true);
              try {
                setQualification(await api.startAutoTradeQualification());
                setQualificationError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not start qualification");
              } finally {
                setBusy(false);
              }
            })();
          }}
          onPause={() => {
            void (async () => {
              setBusy(true);
              try {
                setQualification(await api.pauseAutoTradeQualification());
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not pause");
              } finally {
                setBusy(false);
              }
            })();
          }}
          onResume={() => {
            void (async () => {
              setBusy(true);
              try {
                setQualification(await api.resumeAutoTradeQualification());
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not resume");
              } finally {
                setBusy(false);
              }
            })();
          }}
          onEnableDemoAuto={() => {
            void (async () => {
              setBusy(true);
              try {
                setQualification(await api.enableDemoAutoFromQualification());
                await reload();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not enable Demo Auto");
              } finally {
                setBusy(false);
              }
            })();
          }}
          onAuthoriseTrading={() => {
            void (async () => {
              setBusy(true);
              try {
                const res = await api.authoriseCTraderDemoTrading();
                if (res.authorizationUrl) {
                  window.location.assign(res.authorizationUrl);
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not start OAuth");
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      ) : qualificationError ? (
        <section
          className="gm-qual-dash gm-qual-dash--error"
          data-testid="autotrade-qualification-error"
          aria-label="AutoTrade qualification"
        >
          <div className="gm-qual-dash__head">
            <div>
              <p className="gm-label">AutoTrade qualification</p>
              <h2>Unable to load qualification status</h2>
            </div>
          </div>
          <p className="gm-meta" data-testid="qual-load-error-detail">
            {qualificationError}
          </p>
          <div className="gm-qual-actions">
            <button
              type="button"
              className="gm-btn gm-btn-primary"
              disabled={busy || qualificationLoading}
              data-testid="qual-retry"
              onClick={() => {
                void reload();
              }}
            >
              Retry
            </button>
          </div>
        </section>
      ) : qualificationLoading ? (
        <section
          className="gm-qual-dash"
          data-testid="autotrade-qualification-loading"
          aria-label="AutoTrade qualification"
        >
          <div className="gm-qual-dash__head">
            <div>
              <p className="gm-label">AutoTrade qualification</p>
              <h2>Loading qualification…</h2>
            </div>
          </div>
        </section>
      ) : !brokerConnected ? (
        <section
          className="gm-at-setup-required"
          data-testid="autotrade-setup-required"
          aria-label="Setup required"
        >
          <h2>Setup required</h2>
          <ol>
            <li>Connect cTrader</li>
            <li>Select account</li>
            <li>Configure risk</li>
            <li>Run connection checks</li>
          </ol>
          <div className="gm-prem-pill-actions">
            <Link className="gm-btn gm-btn-primary" to="/brokers" data-testid="autotrade-continue-setup">
              Continue setup
            </Link>
            <button
              type="button"
              className="gm-btn"
              data-testid="autotrade-open-setup-wizard"
              onClick={() => {
                setSetupWizardOpen(true);
                setShowAccounts(true);
              }}
            >
              Full setup wizard
            </button>
          </div>
        </section>
      ) : null}

      {/* Preserve status summary testids */}
      <section
        className="gm-at-summary gm-prem-sr-status"
        data-testid="autotrade-status"
        aria-label="Status summary"
      >
        <div>
          <span className="gm-label">Account</span>
          <strong>{accountLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Mode</span>
          <strong data-testid="autotrade-mode-label">{modeLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Connection</span>
          <strong data-testid="autotrade-connection-label">{connectionLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Market</span>
          <strong data-testid="autotrade-market-label">{marketLabel}</strong>
        </div>
        <div>
          <span className="gm-label">AutoTrade</span>
          <span className={`gm-at-pill ${statusTone(display)}`} data-testid="autotrade-mode-pill">
            {autoTradeLabel}
          </span>
        </div>
        <div>
          <span className="gm-label">Funds</span>
          <strong>{fundsLabel}</strong>
        </div>
      </section>

      {stalePrompt ? (
        <div className="banner stale" role="status" data-testid="autotrade-stale-prompt">
          This tab may be out of date.{" "}
          <button
            type="button"
            className="gm-btn gm-btn-text"
            onClick={() => {
              setStalePrompt(false);
              void reload();
            }}
          >
            Refresh AutoTrade
          </button>
        </div>
      ) : null}

      <p className="gm-prem-section-label">Readiness</p>
      <section className="gm-prem-card" aria-label="Readiness">
        <ul className="gm-prem-check-list" data-testid="autotrade-readiness-list">
          {[
            {
              ok: marketDataConnected,
              warn: !marketDataConnected,
              label: "GoldMeta market data active",
              detail: marketDataLabel
            },
            {
              ok: sync.connected && Boolean(maskedAt) && !sync.isLive,
              warn: !(sync.connected && Boolean(maskedAt)),
              label: sync.isLive
                ? "Pepperstone Live account connected"
                : sync.connected && maskedAt
                  ? "Pepperstone Demo account connected"
                  : "Broker account not connected",
              detail: maskedAt
                ? `${sync.isLive ? "LIVE" : "Demo"} · ${maskedAt}`
                : sync.connected
                  ? "Select a Demo account"
                  : "Connect cTrader"
            },
            {
              ok: Boolean(settings || status?.limits),
              label: "Risk rules loaded",
              detail: "Active"
            },
            {
              ok: !status?.emergencyStopActive,
              warn: Boolean(status?.emergencyStopActive),
              label: "Emergency stop ready",
              detail: status?.emergencyStopActive ? "Active" : "Ready"
            },
            {
              ok: false,
              pending: true,
              label: sync.isLive
                ? "Owner/live approval pending"
                : sync.connected && maskedAt
                  ? "Demo trading permission / execution requirement"
                  : "AutoTrade setup incomplete",
              detail: sync.isLive
                ? "Required for live"
                : sync.connected && maskedAt
                  ? "Demo Auto not enabled"
                  : "Connect and select account"
            },
            {
              ok: false,
              locked: true,
              label: "Live execution disabled",
              detail: "Hard locked"
            }
          ].map((row) => (
            <li key={row.label}>
              <span
                className={`gm-prem-check-ico ${
                  row.ok
                    ? "gm-prem-check-ico--ok"
                    : row.pending || row.warn
                      ? "gm-prem-check-ico--warn"
                      : row.locked
                        ? "gm-prem-check-ico--bad"
                        : "gm-prem-check-ico--warn"
                }`}
                aria-hidden="true"
              >
                {row.ok ? (
                  <CheckCircle2 size={14} />
                ) : row.locked ? (
                  <Lock size={14} />
                ) : (
                  <Circle size={14} />
                )}
              </span>
              <div>
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="gm-prem-section-label">How it works</p>
      <section className="gm-prem-card" aria-label="How it works">
        <ol className="gm-prem-how-steps">
          <li>
            <span aria-hidden="true">
              <Search size={16} />
            </span>
            <div>
              <strong>Plan Found</strong>
              <p>GoldMeta identifies a setup</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">
              <Shield size={16} />
            </span>
            <div>
              <strong>Risk Checked</strong>
              <p>Risk and safeguards validated</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">
              <Scale size={16} />
            </span>
            <div>
              <strong>Execution Decision</strong>
              <p>Allowed / Blocked / Shadow</p>
            </div>
          </li>
        </ol>
      </section>

      <p className="gm-prem-section-label">Controls</p>
      <div className="gm-prem-control-grid" aria-label="AutoTrade controls">
        <article className="gm-prem-control-card">
          <span className="gm-prem-control-ico" aria-hidden="true">
            <Shield size={18} />
          </span>
          <div>
            <strong>Shadow Mode</strong>
            <p>Simulate ideas only</p>
          </div>
          <PremiumStatusChip tone={heroState === "SHADOW" ? "amber" : "off"}>
            {heroState === "SHADOW" ? "ON" : "OFF"}
          </PremiumStatusChip>
        </article>
        <article className="gm-prem-control-card">
          <span className="gm-prem-control-ico" aria-hidden="true">
            <Bot size={18} />
          </span>
          <div>
            <strong>Live AutoTrade</strong>
            <p>Owner approval required</p>
          </div>
          <PremiumStatusChip tone="locked">LOCKED</PremiumStatusChip>
        </article>
        <article className="gm-prem-control-card">
          <span className="gm-prem-control-ico" aria-hidden="true">
            <AlertTriangle size={18} />
          </span>
          <div>
            <strong>Emergency Stop</strong>
            <p>Halt automation instantly</p>
          </div>
          <PremiumStatusChip tone={status?.emergencyStopActive ? "red" : "ok"}>
            {status?.emergencyStopActive ? "ACTIVE" : "READY"}
          </PremiumStatusChip>
        </article>
        <article className="gm-prem-control-card">
          <span className="gm-prem-control-ico" aria-hidden="true">
            <BarChart3 size={18} />
          </span>
          <div>
            <strong>Daily Limits</strong>
            <p>Risk caps loaded</p>
          </div>
          <PremiumStatusChip tone="ok">READY</PremiumStatusChip>
        </article>
      </div>

      <p className="gm-prem-section-label">Risk summary</p>
      <section className="gm-prem-card" aria-label="Risk and account controls">
        <div className="gm-prem-stat-grid gm-prem-stat-grid--2">
          <div className="gm-prem-stat">
            <span>Max risk / trade</span>
            <strong>
              {settings?.fixedRiskAmount != null
                ? money(settings.fixedRiskAmount, currency)
                : "—"}
            </strong>
          </div>
          <div className="gm-prem-stat">
            <span>Max trades / day</span>
            <strong>
              {settings?.maxTradesPerDay != null
                ? String(settings.maxTradesPerDay)
                : status?.limits?.maxTradesPerDay != null
                  ? String(status.limits.maxTradesPerDay)
                  : "—"}
            </strong>
          </div>
          <div className="gm-prem-stat">
            <span>Daily loss limit</span>
            <strong>
              {settings?.maxDailyLoss != null
                ? money(settings.maxDailyLoss, currency)
                : status?.limits?.maxDailyLoss != null
                  ? money(status.limits.maxDailyLoss, currency)
                  : "—"}
            </strong>
          </div>
          <div className="gm-prem-stat">
            <span>Spread guard</span>
            <strong>
              {settings?.maxSpread != null
                ? String(settings.maxSpread)
                : status?.limits?.maxSpread != null
                  ? String(status.limits.maxSpread)
                  : "—"}
            </strong>
          </div>
          <div className="gm-prem-stat">
            <span>Quote freshness</span>
            <strong className={brokerQuoteLive ? "is-ok" : "is-warn"}>
              {brokerQuoteLive ? "LIVE" : "Waiting"}
            </strong>
          </div>
          <div className="gm-prem-stat">
            <span>Broker balance</span>
            <strong>
              {equityAt != null
                ? money(equityAt, currency)
                : sync.connected
                  ? "Unavailable"
                  : "Unavailable"}
            </strong>
          </div>
        </div>
        {!fundedAt && isLiveEnv ? (
          <div className="gm-prem-safety" style={{ marginTop: 10 }} role="status">
            <span aria-hidden="true">
              <AlertTriangle size={16} />
            </span>
            <div>
              <strong>Account funding required</strong>
              <p>Fund the account before shadow eligibility can pass.</p>
            </div>
          </div>
        ) : (
          <div className="gm-prem-safety gm-prem-safety--ok" style={{ marginTop: 10 }} role="status">
            <span aria-hidden="true">
              <Shield size={16} />
            </span>
            <div>
              <strong>No live orders are sent in Shadow Mode</strong>
              <p>You stay in full control until owner approval is granted.</p>
            </div>
          </div>
        )}
      </section>

      {previewNote ? (
        <p className="gm-meta" data-testid="autotrade-preview-note">
          {previewNote}
        </p>
      ) : null}

      <p className="gm-prem-section-label">Execution actions</p>
      <section
        className="gm-prem-card"
        aria-label="Execution control"
        data-testid="autotrade-emergency-bar"
      >
        <div className="gm-prem-pill-actions">
          <button
            type="button"
            className="gm-btn"
            disabled={busy || !status?.mode || status.mode === "OFF"}
            onClick={() => void run(() => api.autoTradeSetMode("OFF"))}
            data-testid="autotrade-pause"
          >
            Pause AutoTrade
          </button>
          <button
            type="button"
            className="gm-btn gm-btn-danger"
            data-testid="autotrade-emergency-stop"
            disabled={busy}
            onClick={() => void emergencyStop()}
          >
            Emergency stop
          </button>
          <button
            type="button"
            className="gm-btn"
            data-testid="autotrade-view-diagnostics"
            aria-expanded={showDiagnostics}
            onClick={() => setShowDiagnostics((v) => !v)}
          >
            View audit log
          </button>
          <button
            type="button"
            className="gm-btn"
            disabled={busy}
            onClick={() => void runPreview()}
            data-testid="autotrade-preview-trade"
          >
            Review shadow
          </button>
          <Link className="gm-btn" to="/brokers" data-testid="autotrade-connect-ctrader">
            Open broker
          </Link>
        </div>
        <p className="gm-meta" style={{ marginTop: 10 }}>
          Live execution cannot be enabled until owner approval is granted.
        </p>
      </section>

      <p className="gm-prem-section-label">Recent evaluations</p>
      <section className="gm-prem-card" aria-label="Recent evaluations">
        <ul className="gm-prem-activity" data-testid="autotrade-recent-evaluations">
          {activityFeed.slice(0, 5).map((item) => (
            <li key={item.id}>
              <span>{item.message}</span>
              <time dateTime={item.at}>
                {new Date(item.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </time>
            </li>
          ))}
          {activityFeed.length === 0 ? (
            <li>
              <span>No recent evaluations yet</span>
              <time>—</time>
            </li>
          ) : null}
        </ul>
      </section>

      {error ? (
        <p className="gm-error" role="alert">
          {error}
        </p>
      ) : null}

      {showLiveConfirm ? (
        <LiveActivationConfirm
          brokerName={
            accounts.find((a) => a.isLive)?.brokerNameTitle ??
            diagnostics?.connection?.brokerName ??
            "Pepperstone"
          }
          accountMasked={
            accounts.find((a) => a.isLive)?.accountIdMasked ??
            diagnostics?.connection?.accountMasked ??
            "—"
          }
          currency={currency}
          riskPerTrade={settings?.fixedRiskAmount ?? 20}
          maxDailyLoss={settings?.maxDailyLoss ?? 50}
          maxTradesPerDay={settings?.maxTradesPerDay ?? 3}
          busy={busy}
          onCancel={() => setShowLiveConfirm(false)}
          onConfirm={confirmLiveAccount}
        />
      ) : null}

      <details
        className="gm-prem-advanced"
        data-testid="autotrade-advanced-controls"
        open={showAccounts || showSettings || showDiagnostics || setupWizardOpen}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          if (!open) {
            setSetupWizardOpen(false);
            setShowAccounts(false);
            setShowSettings(false);
            setShowDiagnostics(false);
          }
        }}
      >
        <summary>Advanced controls &amp; diagnostics</summary>
        <div className="gm-prem-advanced-body">
      <div className="gm-at-mode-tabs" role="tablist" aria-label="Account type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "demo"}
          className={`gm-btn${mode === "demo" ? " is-active" : ""}`}
          data-testid="autotrade-tab-demo"
          onClick={() => setMode("demo")}
        >
          Demo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "live"}
          className={`gm-btn${mode === "live" ? " is-active" : ""}`}
          data-testid="autotrade-tab-live"
          onClick={() => setMode("live")}
        >
          Live
        </button>
      </div>
      {mode === "live" ? (
        <p className="gm-at-live-warn" role="status" data-testid="autotrade-live-warn">
          Live uses <strong>real money</strong>. Selecting a Live account requires typing{" "}
          <strong>ENABLE LIVE</strong>. Order submission stays disabled in this preview.
        </p>
      ) : (
        <p className="gm-meta" data-testid="autotrade-demo-hint">
          Demo uses practice funds. Demo and Live settings are saved separately.
        </p>
      )}

      <div className="gm-autotrade-readonly-banner" data-testid="autotrade-readonly-banner">
        {mode === "live"
          ? "Live execution stays locked. Select Demo to enable Pepperstone Demo AutoTrade."
          : "Demo Auto is available after Authorise Demo Trading + a Pepperstone Demo account. Live orders stay locked."}
      </div>

      <details
        className="gm-prem-nested"
        data-testid="autotrade-full-setup-wizard"
        open={setupWizardOpen}
      >
        <summary>Full setup wizard</summary>
        <AutoTradeOnboarding steps={onboarding} />
      </details>

      <section className="gm-at-actions" aria-label="Primary controls">
        <button
          type="button"
          className="gm-btn gm-btn-primary"
          data-testid="autotrade-select-account"
          onClick={() => setShowAccounts((v) => !v)}
        >
          {sync.accountSelected ? "Manage account" : "Select account"}
        </button>
        <button
          type="button"
          className="gm-btn"
          data-testid="autotrade-edit-settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          Edit AutoTrade settings
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={busy || mode === "live"}
          title={
            mode === "live"
              ? "Switch to Demo — Live Auto stays locked"
              : "Enable Pepperstone Demo AutoTrade"
          }
          data-testid="autotrade-enable-demo-auto"
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await api.setCTraderAutomationMode("DEMO_AUTO");
                setPreviewNote(
                  result.note ??
                    "Demo Auto enabled for Pepperstone Demo. Live stays locked."
                );
                setMode("demo");
                await reload();
                await loadSettings("demo");
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Could not enable Demo Auto"
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Enable Demo Auto
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={mode !== "live"}
          title="Requires Live confirmation — execution still OFF in preview"
          data-testid="autotrade-open-live-confirm"
          onClick={() => setShowLiveConfirm(true)}
        >
          Enable Live Auto
        </button>
      </section>

      {showAccounts ? (
        <section className="gm-at-account-list" data-testid="autotrade-account-list">
          <h2 className="gm-section-title">Authorised broker accounts</h2>
          <p className="gm-meta">
            Showing {mode === "live" ? "Live (real money)" : "Demo (demo funds)"} accounts returned
            by your cTrader connection.
          </p>
          {filteredAccounts.length === 0 ? (
            <p className="gm-meta">No {mode === "live" ? "Live" : "Demo"} accounts found. Connect cTrader first.</p>
          ) : (
            <ul>
              {filteredAccounts.map((acct) => (
                <li key={acct.ctidTraderAccountId}>
                  <button
                    type="button"
                    className={`gm-at-account-option${acct.selected ? " is-selected" : ""}`}
                    disabled={busy}
                    onClick={() => void selectAccount(acct)}
                  >
                    <strong>{acct.brokerNameTitle ?? "Broker"}</strong>
                    <span>
                      {acct.isLive ? "Live account" : "Demo account"} · {acct.accountIdMasked}
                    </span>
                    <span>
                      {acct.depositCurrency ?? "—"}
                      {acct.balance != null ? ` · ${money(acct.balance, acct.depositCurrency ?? "EUR")}` : ""}
                    </span>
                    <span>{acct.connectionStatus ?? "Connected"} · {acct.tradingPermission ?? "Read only"}</span>
                    {acct.selected ? <em>Selected</em> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {showSettings && settings ? (
        <section className="gm-at-settings" data-testid="autotrade-settings-panel">
          <h2 className="gm-section-title">
            {mode === "live" ? "Live" : "Demo"} AutoTrade settings
          </h2>
          <p className="gm-meta">
            Settings are stored separately for Demo and Live under your account. Recommended values
            are shown beside each field.
          </p>
          <div className="gm-at-settings-grid">
            <label>
              Lot sizing
              <select
                value={settings.sizingMode}
                aria-label="Lot sizing mode"
                onChange={(e) =>
                  void saveSettingsPatch({
                    sizingMode: e.target.value as "automatic_risk" | "manual_lots"
                  })
                }
              >
                <option value="automatic_risk">Automatic (from risk)</option>
                <option value="manual_lots">Manual lot size</option>
              </select>
              <span className="gm-meta">
                Recommended: Automatic. Changing this does not silently resize open trades.
              </span>
            </label>
            <label>
              Risk mode
              <select
                value={riskStyle}
                aria-label="Risk mode"
                data-testid="autotrade-risk-style"
                onChange={(e) =>
                  setRiskStyle(e.target.value === "percentage" ? "percentage" : "fixed")
                }
              >
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage of equity</option>
              </select>
            </label>
            <label>
              Fixed risk amount
              <input
                type="number"
                aria-label="Fixed risk amount"
                value={settings.fixedRiskAmount}
                disabled={riskStyle !== "fixed" && settings.sizingMode === "automatic_risk"}
                onChange={(e) =>
                  setSettings({ ...settings, fixedRiskAmount: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ fixedRiskAmount: settings.fixedRiskAmount })}
              />
              <span className="gm-meta">
                Recommended: {String(recommended?.fixedRiskAmount ?? 20)}. Saved when you leave the
                field.
              </span>
            </label>
            <label>
              Percentage risk
              <input
                type="number"
                step="0.01"
                aria-label="Percentage risk"
                value={settings.percentageRisk}
                disabled={riskStyle !== "percentage" && settings.sizingMode === "automatic_risk"}
                onChange={(e) =>
                  setSettings({ ...settings, percentageRisk: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ percentageRisk: settings.percentageRisk })}
              />
            </label>
            <label>
              Manual lot size
              <input
                type="number"
                step="0.01"
                aria-label="Manual lot size"
                value={settings.manualLotSize}
                disabled={settings.sizingMode !== "manual_lots"}
                onChange={(e) =>
                  setSettings({ ...settings, manualLotSize: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ manualLotSize: settings.manualLotSize })}
              />
            </label>
            <label>
              Maximum daily loss
              <input
                type="number"
                value={settings.maxDailyLoss}
                onChange={(e) =>
                  setSettings({ ...settings, maxDailyLoss: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ maxDailyLoss: settings.maxDailyLoss })}
              />
            </label>
            <label>
              Maximum trades per day (1–10)
              <div className="gm-stepper" data-testid="max-trades-stepper">
                <button
                  type="button"
                  className="gm-btn"
                  aria-label="Decrease max trades"
                  disabled={busy || settings.maxTradesPerDay <= 1}
                  onClick={() => {
                    const next = Math.max(1, settings.maxTradesPerDay - 1);
                    setSettings({ ...settings, maxTradesPerDay: next });
                    void saveSettingsPatch({ maxTradesPerDay: next });
                  }}
                >
                  −
                </button>
                <strong data-testid="max-trades-value">{settings.maxTradesPerDay}</strong>
                <button
                  type="button"
                  className="gm-btn"
                  aria-label="Increase max trades"
                  disabled={busy || settings.maxTradesPerDay >= 10}
                  onClick={() => {
                    const next = Math.min(10, settings.maxTradesPerDay + 1);
                    setSettings({ ...settings, maxTradesPerDay: next });
                    void saveSettingsPatch({ maxTradesPerDay: next });
                  }}
                >
                  +
                </button>
              </div>
            </label>
            <label>
              Maximum open Gold positions (1–3)
              <select
                value={settings.maxOpenPositions}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSettings({ ...settings, maxOpenPositions: next });
                  void saveSettingsPatch({ maxOpenPositions: next });
                }}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <label>
              Minimum confidence
              <input
                type="number"
                value={settings.minConfidence}
                onChange={(e) =>
                  setSettings({ ...settings, minConfidence: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ minConfidence: settings.minConfidence })}
              />
            </label>
            <label>
              Minimum risk/reward
              <input
                type="number"
                step="0.1"
                value={settings.minRiskReward}
                onChange={(e) =>
                  setSettings({ ...settings, minRiskReward: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ minRiskReward: settings.minRiskReward })}
              />
            </label>
            <label>
              Maximum spread
              <input
                type="number"
                step="0.01"
                value={settings.maxSpread}
                onChange={(e) => setSettings({ ...settings, maxSpread: Number(e.target.value) })}
                onBlur={() => void saveSettingsPatch({ maxSpread: settings.maxSpread })}
              />
            </label>
            <label>
              Maximum quote age (seconds)
              <input
                type="number"
                value={settings.maxQuoteAgeSeconds}
                onChange={(e) =>
                  setSettings({ ...settings, maxQuoteAgeSeconds: Number(e.target.value) })
                }
                onBlur={() =>
                  void saveSettingsPatch({ maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds })
                }
              />
            </label>
            <label>
              Cooldown after losing trade
              <select
                value={settings.tradeCooldownMinutes}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSettings({ ...settings, tradeCooldownMinutes: next });
                  void saveSettingsPatch({ tradeCooldownMinutes: next });
                }}
              >
                <option value={0}>Off</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            <label>
              Pause after consecutive losses
              <input
                type="number"
                min={1}
                max={10}
                value={settings.pauseAfterConsecutiveLosses}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pauseAfterConsecutiveLosses: Number(e.target.value)
                  })
                }
                onBlur={() =>
                  void saveSettingsPatch({
                    pauseAfterConsecutiveLosses: settings.pauseAfterConsecutiveLosses
                  })
                }
              />
            </label>
            <label>
              Daily profit target
              <input
                type="number"
                value={settings.dailyProfitTarget ?? ""}
                placeholder="Optional"
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    dailyProfitTarget: e.target.value === "" ? null : Number(e.target.value)
                  })
                }
                onBlur={() =>
                  void saveSettingsPatch({
                    dailyProfitTarget: settings.dailyProfitTarget ?? null
                  })
                }
              />
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={Boolean(settings.dailyProfitTargetEnabled)}
                onChange={(e) =>
                  void saveSettingsPatch({ dailyProfitTargetEnabled: e.target.checked })
                }
              />
              Stop new trades after daily profit target
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={Boolean(settings.profitProtectionEnabled)}
                onChange={(e) =>
                  void saveSettingsPatch({ profitProtectionEnabled: e.target.checked })
                }
              />
              Daily profit protection
            </label>
            <label>
              Protected minimum daily P/L
              <input
                type="number"
                value={settings.profitProtectionFloor ?? ""}
                placeholder="e.g. 60"
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    profitProtectionFloor: e.target.value === "" ? null : Number(e.target.value)
                  })
                }
                onBlur={() =>
                  void saveSettingsPatch({
                    profitProtectionFloor: settings.profitProtectionFloor ?? null
                  })
                }
              />
            </label>
            <label>
              Max slippage
              <input
                type="number"
                step="0.01"
                value={settings.maxSlippage ?? 1.5}
                onChange={(e) =>
                  setSettings({ ...settings, maxSlippage: Number(e.target.value) })
                }
                onBlur={() =>
                  void saveSettingsPatch({ maxSlippage: settings.maxSlippage ?? 1.5 })
                }
              />
            </label>
            <label>
              News impact filter
              <select
                value={settings.newsImpactMode ?? "HIGH"}
                onChange={(e) =>
                  void saveSettingsPatch({
                    newsImpactMode: e.target.value as "HIGH" | "MEDIUM" | "OFF"
                  })
                }
              >
                <option value="HIGH">Block High impact</option>
                <option value="MEDIUM">Block Medium + High</option>
                <option value="OFF">Off</option>
              </select>
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.newsFilterEnabled}
                onChange={(e) => void saveSettingsPatch({ newsFilterEnabled: e.target.checked })}
              />
              News filter enabled
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.confirmationCandleRequired}
                onChange={(e) =>
                  void saveSettingsPatch({ confirmationCandleRequired: e.target.checked })
                }
              />
              Confirmation candle
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.trendConfirmationRequired}
                onChange={(e) =>
                  void saveSettingsPatch({ trendConfirmationRequired: e.target.checked })
                }
              />
              Trend confirmation
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.volumeConfirmationRequired}
                onChange={(e) =>
                  void saveSettingsPatch({ volumeConfirmationRequired: e.target.checked })
                }
              />
              Volume confirmation
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.breakEvenEnabled}
                onChange={(e) => void saveSettingsPatch({ breakEvenEnabled: e.target.checked })}
              />
              Break-even rule
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.trailingStopEnabled}
                onChange={(e) => void saveSettingsPatch({ trailingStopEnabled: e.target.checked })}
              />
              Trailing-stop rule
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.partialTakeProfitEnabled}
                onChange={(e) =>
                  void saveSettingsPatch({ partialTakeProfitEnabled: e.target.checked })
                }
              />
              Partial take-profit
            </label>
          </div>
        </section>
      ) : null}

      <p className="gm-meta gm-at-locked-note" data-testid="autotrade-demo-auto-note">
        Demo Auto places Pepperstone Demo orders only. Live Auto and real-money execution stay locked.
      </p>

      <section className="gm-at-cards" aria-label="Daily overview">
        <article className="gm-at-card" data-testid="autotrade-card-market">
          <h3>Market</h3>
          <dl>
            <div>
              <dt>Bid</dt>
              <dd data-testid="autotrade-bid">{num(sync.bid ?? quote?.bid ?? connection?.bid, 3)}</dd>
            </div>
            <div>
              <dt>Ask</dt>
              <dd data-testid="autotrade-ask">{num(sync.ask ?? quote?.ask ?? connection?.ask, 3)}</dd>
            </div>
            <div>
              <dt>Spread</dt>
              <dd data-testid="autotrade-spread">
                {num(sync.spread ?? quote?.spread ?? connection?.spread, 3)}
              </dd>
            </div>
            <div>
              <dt>Market status</dt>
              <dd data-testid="autotrade-market-status">
                {sync.marketStatusRaw
                  ? marketOpen
                    ? "Market open"
                    : /CLOSE/i.test(sync.marketStatusRaw)
                      ? "Market closed"
                      : sync.marketStatusRaw.replace(/_/g, " ")
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Quote</dt>
              <dd data-testid="autotrade-quote-label">{sync.quoteLabel}</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd data-testid="autotrade-execution-label">{sync.executionLabel}</dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-signal">
          <h3>Current signal</h3>
          <dl>
            <div>
              <dt>Decision</dt>
              <dd>Waiting · preview only</dd>
            </div>
            <div>
              <dt>Min confidence</dt>
              <dd>{settings?.minConfidence ?? "—"}%</dd>
            </div>
          </dl>
          <button type="button" className="gm-btn gm-btn-text" onClick={() => void runPreview()}>
            Preview next trade
          </button>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-risk">
          <h3>Trade size &amp; risk</h3>
          <dl data-testid="autotrade-budget">
            <div>
              <dt>Lot sizing</dt>
              <dd>
                {settings?.sizingMode === "manual_lots"
                  ? "Manual lot size"
                  : "Automatic (from risk)"}
              </dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>
                {riskStyle === "percentage"
                  ? `${settings?.percentageRisk ?? "—"}% of equity`
                  : money(settings?.fixedRiskAmount ?? limits.maxLossPerTrade, currency)}
              </dd>
            </div>
            <div>
              <dt>Manual lots</dt>
              <dd>{settings?.manualLotSize ?? "—"}</dd>
            </div>
            <div>
              <dt>Broker min / step</dt>
              <dd>
                {diagnostics?.symbol?.minVolume ?? "—"} / {diagnostics?.symbol?.volumeStep ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Broker compatibility</dt>
              <dd data-testid="autotrade-broker-compat">
                {diagnostics?.symbol?.minVolume != null &&
                settings?.sizingMode === "automatic_risk" &&
                (settings.fixedRiskAmount ?? 0) > 0
                  ? "Checked when you preview"
                  : diagnostics?.goldSymbolFound
                    ? "Symbol ready"
                    : "Connect & select account"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-account">
          <h3>Today</h3>
          <dl>
            <div>
              <dt>P/L</dt>
              <dd>{money(budget?.dailyRealisedPnl ?? 0, currency)}</dd>
            </div>
            <div>
              <dt>Trades taken</dt>
              <dd>
                {budget?.tradesUsed ?? 0} / {settings?.maxTradesPerDay ?? limits.maxTradesPerDay}
              </dd>
            </div>
            <div>
              <dt>Daily limit used</dt>
              <dd>
                {money(budget?.dailyRealisedPnl ?? 0, currency)} /{" "}
                {money(settings?.maxDailyLoss ?? limits.maxDailyLoss, currency)}
              </dd>
            </div>
            <div>
              <dt>Open positions</dt>
              <dd>{status?.positions?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{money(demoAccount?.balance ?? connection?.balance, currency)}</dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-position">
          <h3>Current position</h3>
          {position ? (
            <dl>
              <div>
                <dt>Direction</dt>
                <dd>{position.direction}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{position.size}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd>{num(position.entry, 3)}</dd>
              </div>
              <div>
                <dt>SL</dt>
                <dd>{num(position.stop, 3)}</dd>
              </div>
              <div>
                <dt>TP</dt>
                <dd>{num(position.takeProfit, 3)}</dd>
              </div>
              <div>
                <dt>Floating P/L</dt>
                <dd>{money(position.unrealisedPnl, currency)}</dd>
              </div>
            </dl>
          ) : (
            <p className="gm-meta">No open Gold position.</p>
          )}
        </article>
      </section>

      <details
        className="gm-at-advanced"
        data-testid="autotrade-advanced"
        open={showDiagnostics}
        onToggle={(e) => setShowDiagnostics((e.target as HTMLDetailsElement).open)}
      >
        <summary>View diagnostics</summary>
        <div className="gm-at-advanced-body">
          <p className="gm-meta">
            Technical details for support. Secrets and full account numbers are never shown.
          </p>
          <ul className="gm-meta">
            <li>
              Selected mode: {mode === "live" ? "Live" : "Demo"} · Order submission: disabled in
              preview
            </li>
            <li>
              Credentials configured:{" "}
              {diagnostics?.credentialsConfigured || centre?.readiness?.oauthConfigured
                ? "yes"
                : "unknown / missing"}
            </li>
            <li>Pepperstone confirmed: {diagnostics?.pepperstoneConfirmed ? "yes" : "not yet"}</li>
            <li>
              Margin metadata:{" "}
              {diagnostics?.marginMetadataAvailable
                ? "available"
                : "not available yet — trading remains locked"}
            </li>
            <li>
              Volume rules:{" "}
              {diagnostics?.volumeRulesAvailable ? "available" : "not available yet"}
            </li>
          </ul>
          <h3 className="gm-section-title">Operating mode (analysis)</h3>
          <div className="gm-autotrade-mode-grid">
            {(
              [
                ["OFF", "Off"],
                ["SHADOW", "Shadow (analysis only)"]
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`gm-btn${status?.mode === m ? " is-active" : ""}`}
                data-testid={`autotrade-mode-${m}`}
                disabled={busy || Boolean(status?.locked && m !== "OFF")}
                onClick={() => void run(() => api.autoTradeSetMode(m))}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="gm-btn"
              data-testid="autotrade-mode-IG_DEMO_AUTO"
              disabled
              title="Order submission is currently disabled in this preview"
            >
              Demo Auto (locked)
            </button>
            <button
              type="button"
              className="gm-btn"
              data-testid="autotrade-mode-IG_LIVE_AUTO"
              disabled
              title="Order submission is currently disabled in this preview"
            >
              Live Auto (locked)
            </button>
          </div>
          <Link className="gm-btn" to="/brokers">
            Open Broker Control Centre
          </Link>
        </div>
      </details>

      <details
        className="gm-at-other-brokers"
        data-testid="autotrade-other-brokers"
        open={showT212 || selectedBroker === "T212_INVEST" || selectedBroker === "MANUAL"}
        onToggle={(e) => setShowT212((e.target as HTMLDetailsElement).open)}
      >
        <summary>Other brokers (not part of the cTrader journey)</summary>
        <div className="gm-autotrade-broker-grid" data-testid="autotrade-broker-selection">
          <button
            type="button"
            className={`gm-autotrade-broker-card${
              selectedBroker === "PEPPERSTONE_CTRADER" ? " is-active" : ""
            }`}
            disabled={busy}
            onClick={() => selectBroker("PEPPERSTONE_CTRADER")}
          >
            <strong>Pepperstone cTrader</strong>
            <span>Primary path · Demo or Live · AutoTrade OFF</span>
          </button>
          <button
            type="button"
            className={`gm-autotrade-broker-card${
              selectedBroker === "T212_INVEST" ? " is-active" : ""
            }`}
            disabled={busy}
            onClick={() => selectBroker("T212_INVEST")}
          >
            <strong>Trading 212 Practice</strong>
            <span>Separate gold-proxy path · read-only</span>
          </button>
          <button
            type="button"
            className={`gm-autotrade-broker-card${selectedBroker === "MANUAL" ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => selectBroker("MANUAL")}
            data-testid="autotrade-manual-note"
          >
            <strong>Manual XAUUSD</strong>
            <span>Signals and confirm workflow · no broker orders</span>
          </button>
        </div>

        {selectedBroker === "T212_INVEST" ? (
          <section className="gm-autotrade-panel" data-testid="autotrade-t212-panel">
            <h3 className="gm-section-title">Trading 212 Practice</h3>
            <p className="gm-autotrade-disclaimer" data-testid="autotrade-t212-disclaimer">
              {status?.t212Disclaimer ?? T212_PROXY_DISCLAIMER_CLIENT}
            </p>
            <p className="gm-meta">
              Connection: {t212?.connectionState ?? "Disconnected"} · Orders locked
            </p>
            <div className="gm-autotrade-actions">
              <button
                type="button"
                className="gm-btn"
                disabled={busy}
                onClick={() => void run(() => api.autoTradeT212Connect("PRACTICE"))}
              >
                Connect Trading 212
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy}
                onClick={() => void searchInstruments()}
              >
                Search gold instruments
              </button>
            </div>
            {showInstrumentPicker ? (
              <ul className="gm-autotrade-candidate-list">
                {candidates.map((c) => (
                  <li key={c.instrumentId}>
                    <button
                      type="button"
                      className="gm-autotrade-candidate"
                      onClick={() => void confirmInstrument(c)}
                    >
                      <strong>{c.ticker}</strong>
                      <span>{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {proposal ? (
              <p className="gm-meta">
                Pending proposal status:{" "}
                {proposal.status === "DRY_RUN_APPROVED"
                  ? "Trade preview passed the safety checks"
                  : proposal.status === "SUBMISSION_DISABLED"
                    ? "Order submission is currently locked"
                    : proposal.status.replace(/_/g, " ")}
              </p>
            ) : null}
            <label className="gm-meta">
              Instrument query
              <input
                value={instrumentQuery}
                onChange={(e) => setInstrumentQuery(e.target.value)}
              />
            </label>
          </section>
        ) : null}
      </details>

      <section className="gm-autotrade-panel" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="gm-section-title">
          Activity
        </h2>
        <ul className="gm-autotrade-activity" data-testid="autotrade-activity">
          {activityFeed.map((item) => (
            <li key={item.id} data-level={item.level}>
              <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      </section>
        </div>
      </details>
    </div>
  );
}
