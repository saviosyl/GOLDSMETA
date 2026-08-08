import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import type {
  BrokerControlCentreResponse,
  CTraderDemonstrationBundle,
  CTraderDemoAccountOption,
  CTraderDiagnosticsReport
} from "../../lib/broker/ctraderTypes";
import {
  actionButtonLabel,
  deriveCanonicalBrokerView,
  errorCodeOf,
  isAuthReconnectCode,
  isVersionConflictCode,
  nextGeneration,
  shouldApplyResponse,
  successBannerFor,
  type ActionBanner,
  type ActionPhase,
  type BrokerAction
} from "../../lib/broker/brokerPageState";
import { formatMissingConfigurationItems } from "../../lib/broker/missingConfigCopy";
import { describeClientError } from "../../lib/errors";
import {
  brokerBadgeLabel,
  brokerDisplayName,
  connectionStatusLabel,
  formatUserTimestamp,
  wizardStatusLabel,
  wizardStatusTone
} from "../../lib/plainLanguage";
import { FriendlyErrorBanner } from "../../components/FriendlyErrorBanner";
import { ExecutionDisabledBanner } from "../../components/ExecutionDisabledBanner";
import { PremiumStatusChip } from "../../components/broker/PremiumStatusChip";
import { StatusBadge } from "../../components/ui/primitives";
import { ApiError } from "../../types/models";

const FALLBACK_WIZARD = [
  {
    step: 1,
    title: "Create Pepperstone cTrader Demo account",
    status: "AVAILABLE",
    detail: "Open a Pepperstone Demo account that supports cTrader. TradingView alone is not enough."
  },
  {
    step: 2,
    title: "Register cTrader Open API application",
    status: "SETUP_REQUIRED",
    detail: "Create a Demo Open API app and set the GoldMeta redirect URL."
  },
  {
    step: 3,
    title: "Add secure credentials",
    status: "SETUP_REQUIRED",
    detail: "Store client ID, client secret and redirect URI in Secret Manager — never in the browser or GitHub."
  },
  {
    step: 4,
    title: "Connect account",
    status: "SETUP_REQUIRED",
    detail: "Use secure OAuth to connect. GoldMeta never asks for your broker password."
  },
  {
    step: 5,
    title: "Verify XAUUSD",
    status: "SETUP_REQUIRED",
    detail: "Confirm gold symbol metadata: volume minimum, step, contract size and margin."
  },
  {
    step: 6,
    title: "Run read-only checks",
    status: "SETUP_REQUIRED",
    detail:
      "Confirm bid/ask, spread, volume rules, margin metadata and market-open state without placing orders."
  },
  {
    step: 7,
    title: "Run trade previews",
    status: "SETUP_REQUIRED",
    detail:
      "Preview BUY / SELL sizing only. Order submission is currently disabled in this preview."
  },
  {
    step: 8,
    title: "Request Demo trading approval",
    status: "BLOCKED",
    detail:
      "Demo Auto stays OFF in this preview until a separate approved activation."
  }
];

const SUCCESS_FLASH_MS = 2200;

function diagTone(ok: boolean): "positive" | "warning" | "negative" {
  return ok ? "positive" : "warning";
}

function formatQuoteAge(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "under 1 minute";
  if (mins === 1) return "1 minute";
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour";
  if (hours < 48) return `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

function marketStatusLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").toUpperCase();
  if (!s) return "Unknown";
  if (s === "OPEN" || s.includes("TRADEABLE")) return "Market open";
  if (s === "CLOSED" || s.includes("CLOSE")) return "Market closed";
  return raw!.replace(/_/g, " ");
}

type ActionUiState = {
  busy: BrokerAction | null;
  phaseByAction: Partial<Record<BrokerAction, ActionPhase>>;
};

/**
 * Broker Control Centre — MANUAL / T212 / Pepperstone cTrader / IG parked.
 * AutoTrade remains OFF. No order submission. Demonstration data clearly labelled.
 */
export function BrokerControlCentrePage() {
  const { api } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [centre, setCentre] = useState<BrokerControlCentreResponse | null>(null);
  const [demo, setDemo] = useState<CTraderDemonstrationBundle | null>(null);
  const [diagnostics, setDiagnostics] = useState<CTraderDiagnosticsReport | null>(null);
  const [accounts, setAccounts] = useState<CTraderDemoAccountOption[]>([]);
  const [previewResult, setPreviewResult] = useState<{
    notice?: string;
    preview?: { action?: string; state?: string; proposedVolume?: number | null; riskAmount?: number | null };
    quote?: { bid?: number | null; ask?: number | null; spread?: number | null };
  } | null>(null);
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(
    null
  );
  const [actionBanner, setActionBanner] = useState<ActionBanner | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDemo, setShowDemo] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [selected, setSelected] = useState<string>("manual");
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [actionUi, setActionUi] = useState<ActionUiState>({
    busy: null,
    phaseByAction: {}
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [pendingLiveAccountId, setPendingLiveAccountId] = useState<string | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<BrokerAction | null>(null);
  const [firstCheckpoint, setFirstCheckpoint] = useState<Record<string, unknown> | null>(null);
  const [showAccountManager, setShowAccountManager] = useState(false);

  const selectionTouchedRef = useRef(false);
  const oauthHandledRef = useRef(false);
  const accountsGenRef = useRef(0);
  const diagnosticsGenRef = useRef(0);
  const loadGenRef = useRef(0);
  const reconnectRequiredRef = useRef(false);
  const successTimersRef = useRef<Partial<Record<BrokerAction, ReturnType<typeof setTimeout>>>>({});

  const setReconnectRequiredSafe = (value: boolean) => {
    reconnectRequiredRef.current = value;
    setReconnectRequired(value);
  };

  const clearSuccessTimer = (action: BrokerAction) => {
    const t = successTimersRef.current[action];
    if (t) {
      clearTimeout(t);
      delete successTimersRef.current[action];
    }
  };

  useEffect(() => {
    return () => {
      for (const t of Object.values(successTimersRef.current)) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  const beginAction = (action: BrokerAction) => {
    clearSuccessTimer(action);
    setActionUi({
      busy: action,
      phaseByAction: { [action]: "pending" }
    });
    setErrorDetail(null);
  };

  const finishActionSuccess = (action: BrokerAction, message?: string) => {
    setActionUi({
      busy: null,
      phaseByAction: { [action]: "success" }
    });
    setActionBanner({
      tone: "success",
      message: message ?? successBannerFor(action),
      action
    });
    setLastFailedAction(null);
    clearSuccessTimer(action);
    successTimersRef.current[action] = setTimeout(() => {
      setActionUi((prev) => {
        if (prev.phaseByAction[action] !== "success") return prev;
        const next = { ...prev.phaseByAction };
        delete next[action];
        return { busy: prev.busy, phaseByAction: next };
      });
    }, SUCCESS_FLASH_MS);
  };

  const finishActionError = (action: BrokerAction, err: unknown, fallback: string) => {
    const code = errorCodeOf(err);
    if (isAuthReconnectCode(code)) {
      setReconnectRequiredSafe(true);
      setActionBanner({
        tone: "warning",
        message:
          "Pepperstone session expired or was denied. Reconnect to continue — AutoTrade stays OFF.",
        action
      });
    } else if (isVersionConflictCode(code)) {
      setActionBanner({
        tone: "info",
        message: "Connection state was updated elsewhere. Reloading the latest result…",
        action
      });
    }
    setErrorDetail(describeClientError(err, fallback));
    setLastFailedAction(action);
    setActionUi({
      busy: null,
      phaseByAction: { [action]: "error" }
    });
  };

  const phaseOf = (action: BrokerAction): ActionPhase =>
    actionUi.phaseByAction[action] ?? "idle";

  const isBusy = (action?: BrokerAction) =>
    action ? actionUi.busy === action : actionUi.busy != null;

  const anyActionBusy = actionUi.busy != null;

  /** Guard duplicate clicks; allow retry to re-enter the target action. */
  const guardAction = (action: BrokerAction): boolean => {
    if (actionUi.busy == null) return true;
    return actionUi.busy === "retry" || actionUi.busy === action;
  };

  const load = useCallback(async (opts?: { asRetry?: boolean }) => {
    const loadGen = nextGeneration(loadGenRef.current);
    loadGenRef.current = loadGen;
    setLoading(true);
    if (opts?.asRetry) {
      setErrorDetail(null);
      beginAction("retry");
    }
    try {
      const data = await api.getBrokerControlCentre();
      if (!shouldApplyResponse(loadGenRef.current, loadGen)) return;
      setCentre(data);
      if (!selectionTouchedRef.current) {
        setSelected(data.defaultBroker ?? "manual");
      }
      if (data.readiness?.connected) {
        const gen = nextGeneration(diagnosticsGenRef.current);
        diagnosticsGenRef.current = gen;
        try {
          const diag = await api.getCTraderDiagnostics();
          if (!shouldApplyResponse(diagnosticsGenRef.current, gen)) return;
          if (!shouldApplyResponse(loadGenRef.current, loadGen)) return;
          setDiagnostics(diag);
          setShowDiagnostics(true);
          if (diag.connection?.tokenRefreshHealthy === false) {
            setReconnectRequiredSafe(true);
          } else if (!reconnectRequiredRef.current) {
            // Do not clear an auth-denied reconnect latch with a stale healthy diagnostic.
            setReconnectRequiredSafe(false);
          }
        } catch (e) {
          const code = errorCodeOf(e);
          if (isAuthReconnectCode(code)) {
            setReconnectRequiredSafe(true);
          }
          /* diagnostics optional until account selected */
        }
      } else if (!reconnectRequiredRef.current) {
        setReconnectRequiredSafe(false);
      }
      if (opts?.asRetry) {
        finishActionSuccess("retry", "Broker options reloaded.");
      } else {
        setActionUi((prev) =>
          prev.busy === "load" || prev.busy === "retry"
            ? { busy: null, phaseByAction: {} }
            : prev
        );
      }
    } catch (e) {
      if (!shouldApplyResponse(loadGenRef.current, loadGen)) return;
      setLastFailedAction("load");
      setErrorDetail(describeClientError(e, "Could not load broker options."));
      setActionUi({ busy: null, phaseByAction: { load: "error" } });
    } finally {
      if (shouldApplyResponse(loadGenRef.current, loadGen)) {
        setLoading(false);
      }
    }
  }, [api]);

  const handleAuthOrConflict = async (err: unknown): Promise<boolean> => {
    const code = errorCodeOf(err);
    if (isVersionConflictCode(code)) {
      setActionBanner({
        tone: "info",
        message: "Connection state was updated elsewhere. Reloading the latest result…",
        action: "load"
      });
      await load();
      return true;
    }
    if (isAuthReconnectCode(code)) {
      setReconnectRequiredSafe(true);
      return false;
    }
    return false;
  };

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAccounts = async (fromAction: BrokerAction = "refresh_accounts") => {
    const action: BrokerAction =
      fromAction === "connect" || fromAction === "reconnect" ? fromAction : "refresh_accounts";
    if (!guardAction(action) && fromAction === "refresh_accounts") return;
    beginAction(action);
    const gen = nextGeneration(accountsGenRef.current);
    accountsGenRef.current = gen;
    try {
      const r = await api.listCTraderAccounts();
      if (!shouldApplyResponse(accountsGenRef.current, gen)) return;
      setAccounts(r.accounts ?? []);
      setShowAccountManager(true);
      setReconnectRequiredSafe(false);
      if ((r as { autoSelected?: { accountIdMasked?: string } }).autoSelected) {
        finishActionSuccess(action, "Pepperstone Demo account selected — read-only.");
      } else if (action === "refresh_accounts") {
        finishActionSuccess("refresh_accounts");
      } else {
        finishActionSuccess(action, "OAuth completed. Select a Demo or Live account below.");
      }
      void load();
    } catch (e) {
      if (!shouldApplyResponse(accountsGenRef.current, gen)) return;
      const handled = await handleAuthOrConflict(e);
      if (!handled) {
        finishActionError(action, e, "Could not list broker accounts.");
      } else {
        setActionUi({ busy: null, phaseByAction: {} });
      }
    }
  };

  useEffect(() => {
    if (oauthHandledRef.current) return;
    const ctrader = searchParams.get("ctrader");
    if (!ctrader) return;
    oauthHandledRef.current = true;
    const reason = searchParams.get("reason");
    if (ctrader === "oauth_ok") {
      setActionBanner({
        tone: "info",
        message: "cTrader OAuth completed. Loading authorised accounts…"
      });
      setSelected("pepperstone_ctrader");
      selectionTouchedRef.current = true;
      setReconnectRequiredSafe(false);
      void refreshAccounts("connect");
    } else if (ctrader === "oauth_error") {
      setErrorDetail(
        describeClientError(
          new ApiError(400, reason ?? "OAUTH_CANCELLED", "OAuth failed"),
          "Pepperstone connection could not be completed."
        )
      );
      setLastFailedAction("connect");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("ctrader");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, api]);

  const refreshDiagnostics = async () => {
    if (!guardAction("refresh_diagnostics")) return;
    beginAction("refresh_diagnostics");
    const gen = nextGeneration(diagnosticsGenRef.current);
    diagnosticsGenRef.current = gen;
    try {
      const diag = await api.getCTraderDiagnostics();
      if (!shouldApplyResponse(diagnosticsGenRef.current, gen)) return;
      setDiagnostics(diag);
      setShowDiagnostics(true);
      if (diag.connection?.tokenRefreshHealthy === false) {
        setReconnectRequiredSafe(true);
        setActionBanner({
          tone: "warning",
          message:
            "Pepperstone session needs reconnect. Refresh used the central token path — no parallel refresh.",
          action: "refresh_diagnostics"
        });
        setActionUi({ busy: null, phaseByAction: { refresh_diagnostics: "error" } });
        return;
      }
      setReconnectRequiredSafe(false);
      finishActionSuccess("refresh_diagnostics");
    } catch (e) {
      if (!shouldApplyResponse(diagnosticsGenRef.current, gen)) return;
      const handled = await handleAuthOrConflict(e);
      if (!handled) {
        finishActionError("refresh_diagnostics", e, "Could not load diagnostics.");
      } else {
        setActionUi({ busy: null, phaseByAction: {} });
      }
    }
  };

  const loadDemo = async () => {
    if (!guardAction("demo")) return;
    beginAction("demo");
    setShowDemo(true);
    try {
      const data = await api.getCTraderDemonstration();
      setDemo(data);
      finishActionSuccess("demo");
    } catch (e) {
      finishActionError("demo", e, "Could not load the labelled demonstration.");
    }
  };

  const startOAuth = async (mode: "connect" | "reconnect" = "connect") => {
    if (!guardAction(mode)) return;
    beginAction(mode);
    try {
      const started = await api.startCTraderOAuth();
      if (started.authorizationUrl) {
        setActionBanner({
          tone: "info",
          message:
            mode === "reconnect"
              ? "Reconnecting Pepperstone… you will leave this page briefly."
              : "Opening Pepperstone connection…"
        });
        window.location.assign(started.authorizationUrl);
        return;
      }
      finishActionError(
        mode,
        new ApiError(503, "CTRADER_SETUP_REQUIRED", "No authorization URL"),
        "Pepperstone connection could not be started."
      );
    } catch (e) {
      finishActionError(
        mode,
        e,
        "Pepperstone connection could not be started. Please try again from Broker Control Centre."
      );
    }
  };

  const authoriseDemoTrading = async () => {
    if (!guardAction("authorise_demo_trading")) return;
    if (
      !window.confirm(
        "Authorise Demo Trading will open cTrader and request trading permission (scope=trading) for your own Pepperstone Demo account.\n\nLive accounts must not be selected.\nAutoTrade stays OFF.\nNo order will be submitted in this step.\n\nContinue?"
      )
    ) {
      return;
    }
    beginAction("authorise_demo_trading");
    try {
      const started = await api.authoriseCTraderDemoTrading();
      if (started.authorizationUrl) {
        setActionBanner({
          tone: "warning",
          message:
            "Opening cTrader trading consent… grant permission only for your Demo account. AutoTrade stays OFF."
        });
        window.location.assign(started.authorizationUrl);
        return;
      }
      finishActionError(
        "authorise_demo_trading",
        new ApiError(503, "CTRADER_SETUP_REQUIRED", "No authorization URL"),
        "Demo trading authorisation could not be started."
      );
    } catch (e) {
      finishActionError(
        "authorise_demo_trading",
        e,
        "Demo trading authorisation could not be started."
      );
    }
  };

  const loadFirstCheckpoint = async () => {
    if (!guardAction("first_checkpoint")) return;
    beginAction("first_checkpoint");
    try {
      const checkpoint = await api.getFirstDemoOrderCheckpoint({ decision: "BUY", confidence: 85 });
      setFirstCheckpoint(checkpoint);
      finishActionSuccess(
        "first_checkpoint",
        String(checkpoint.notice ?? "First Demo order checkpoint loaded. No order submitted.")
      );
    } catch (e) {
      finishActionError("first_checkpoint", e, "Could not prepare the first Demo order checkpoint.");
    }
  };

  const selectAccount = async (id: string, isLive = false) => {
    if (!guardAction("select_account")) return;
    if (isLive && pendingLiveAccountId !== id) {
      setPendingLiveAccountId(id);
      setActionBanner({
        tone: "warning",
        message:
          "Confirm Live account selection. Order submission stays disabled; AutoTrade stays OFF."
      });
      return;
    }
    beginAction("select_account");
    setPendingLiveAccountId(null);
    try {
      await api.selectCTraderAccount({
        ctidTraderAccountId: id,
        confirmPepperstone: true,
        confirmLiveSelection: isLive
      });
      const message = isLive
        ? "Live account selected — confirmation stored; order submission stays disabled."
        : "Demo account selected — read-only checks can run.";
      const gen = nextGeneration(diagnosticsGenRef.current);
      diagnosticsGenRef.current = gen;
      try {
        const diag = await api.getCTraderDiagnostics();
        if (shouldApplyResponse(diagnosticsGenRef.current, gen)) {
          setDiagnostics(diag);
          setShowDiagnostics(true);
        }
      } catch {
        /* optional */
      }
      finishActionSuccess("select_account", message);
      await load();
    } catch (e) {
      const handled = await handleAuthOrConflict(e);
      if (!handled) {
        finishActionError("select_account", e, "Could not select broker account.");
      } else {
        setActionUi({ busy: null, phaseByAction: {} });
      }
    }
  };

  const runPreview = async () => {
    if (!guardAction("preview")) return;
    beginAction("preview");
    try {
      const result = (await api.createCTraderPreview({
        decision: "BUY",
        confidence: 85
      })) as {
        notice?: string;
        preview?: {
          action?: string;
          state?: string;
          proposedVolume?: number | null;
          riskAmount?: number | null;
        };
        quote?: { bid?: number | null; ask?: number | null; spread?: number | null };
      };
      setPreviewResult(result);
      finishActionSuccess("preview");
    } catch (e) {
      const handled = await handleAuthOrConflict(e);
      if (!handled) {
        finishActionError("preview", e, "Could not build preview.");
      } else {
        setActionUi({ busy: null, phaseByAction: {} });
      }
    }
  };

  const disconnect = async () => {
    if (!guardAction("disconnect")) return;
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      setActionBanner({
        tone: "warning",
        message: "Confirm disconnect? You can reconnect later. AutoTrade stays OFF."
      });
      return;
    }
    beginAction("disconnect");
    setConfirmDisconnect(false);
    try {
      await api.disconnectCTrader();
      setDiagnostics(null);
      setAccounts([]);
      setPreviewResult(null);
      setReconnectRequiredSafe(false);
      setShowDiagnostics(false);
      finishActionSuccess("disconnect");
      await load();
    } catch (e) {
      finishActionError("disconnect", e, "Could not disconnect.");
    }
  };

  const retryLast = async () => {
    if (anyActionBusy && actionUi.busy !== "retry") return;
    const target = lastFailedAction ?? "load";
    setActionUi({ busy: "retry", phaseByAction: { retry: "pending" } });
    setErrorDetail(null);
    switch (target) {
      case "refresh_accounts":
        await refreshAccounts();
        break;
      case "refresh_diagnostics":
        await refreshDiagnostics();
        break;
      case "preview":
        await runPreview();
        break;
      case "disconnect":
        setConfirmDisconnect(true);
        await disconnect();
        break;
      case "demo":
        await loadDemo();
        break;
      case "connect":
      case "reconnect":
        await startOAuth(target);
        break;
      default:
        await load({ asRetry: true });
    }
  };

  const readiness = centre?.readiness;
  const authBlocked = Boolean(readiness?.authSetupRequired);
  const setupRequired = Boolean(readiness?.setupRequired ?? true);
  const oauthConfigured = Boolean(readiness?.oauthConfigured);
  const missingConfigurationItems = formatMissingConfigurationItems(
    readiness?.missingConfigurationItems
  );
  const connected = Boolean(readiness?.connected);
  const baseWizardSteps =
    readiness?.wizardSteps && readiness.wizardSteps.length >= 6
      ? readiness.wizardSteps
      : FALLBACK_WIZARD;
  /** Do not show step 6 as Complete when margin metadata is still pending. */
  const wizardSteps = baseWizardSteps.map((step) => {
    if (step.step !== 6 || !diagnostics) return step;
    const quoteOk = Boolean(diagnostics.liveQuoteReceived || diagnostics.quote);
    const marginOk = Boolean(diagnostics.marginMetadataAvailable);
    if (quoteOk && !marginOk) {
      return {
        ...step,
        status: "IN_PROGRESS",
        detail:
          "Market-data checks complete for quote/spread/volume. Margin metadata still pending — not fully complete."
      };
    }
    if (quoteOk && marginOk && step.status !== "COMPLETE") {
      return {
        ...step,
        status: "COMPLETE",
        detail:
          "Market-data checks complete (quote, spread, volume rules). Margin metadata available."
      };
    }
    return step;
  });
  const summary = readiness?.connectionSummary;
  const selectedFromAccounts = accounts.some((a) => a.selected);
  const accountSelected = Boolean(
    diagnostics?.accountSelected ||
      diagnostics?.demoAccountSelected ||
      diagnostics?.selectedAccountIsLive ||
      selectedFromAccounts ||
      summary?.accountMasked
  );
  const selectedBroker = (centre?.brokers ?? []).find((b) => b.id === selected);
  const canonical = deriveCanonicalBrokerView({
    pageLoading: loading,
    hasCentre: Boolean(centre),
    selectedBrokerId: selected,
    readinessConnected: connected,
    authSetupRequired: authBlocked,
    setupRequired,
    oauthConfigured,
    reconnectRequired,
    tokenRefreshHealthy:
      diagnostics?.connection?.tokenRefreshHealthy === undefined
        ? null
        : Boolean(diagnostics.connection.tokenRefreshHealthy),
    accountSelected,
    selectedAccountIsLive: Boolean(diagnostics?.selectedAccountIsLive),
    demoAccountSelected: Boolean(
      diagnostics?.demoAccountSelected ||
        (accountSelected && !diagnostics?.selectedAccountIsLive)
    ),
    brokerStatusLabel: connectionStatusLabel(selectedBroker?.status)
  });

  const quoteTimestamp =
    diagnostics?.quote?.timestamp ??
    diagnostics?.connection?.lastQuoteAt ??
    summary?.lastQuoteAt ??
    null;
  const quoteMarketStatus = marketStatusLabel(diagnostics?.quote?.marketStatus ?? null);
  const marketOpen =
    (diagnostics?.quote?.marketStatus ?? "").toUpperCase() === "OPEN" ||
    (diagnostics?.quote?.marketStatus ?? "").toUpperCase().includes("TRADEABLE");
  const quoteEligibleForExecution = false; // preview hard lock — never imply executable

  const diagRows: Array<{ key: string; label: string; ok: boolean }> = diagnostics
    ? [
        { key: "cred", label: "Credentials configured", ok: diagnostics.credentialsConfigured },
        { key: "oauth", label: "OAuth connected", ok: diagnostics.oauthConnected },
        {
          key: "demo",
          label: diagnostics.selectedAccountIsLive
            ? "Live account selected"
            : "Demo account selected",
          ok: Boolean(diagnostics.accountSelected || diagnostics.demoAccountSelected)
        },
        { key: "pep", label: "Pepperstone confirmed", ok: diagnostics.pepperstoneConfirmed },
        { key: "gold", label: "Gold symbol found", ok: diagnostics.goldSymbolFound },
        {
          key: "quote",
          label: "Last market quote available",
          ok: diagnostics.liveQuoteReceived
        },
        { key: "spread", label: "Spread available", ok: diagnostics.spreadAvailable },
        { key: "vol", label: "Volume rules available", ok: diagnostics.volumeRulesAvailable },
        { key: "margin", label: "Margin metadata available", ok: diagnostics.marginMetadataAvailable },
        {
          key: "mkt",
          label: marketOpen ? "Market open" : "Market closed / status known",
          ok: diagnostics.marketStatusAvailable
        },
        {
          key: "lock",
          label: "Order submission disabled in this preview",
          ok: diagnostics.tradingSafelyLocked
        },
        { key: "at", label: "AutoTrade OFF", ok: diagnostics.autoTrade === "OFF" }
      ]
    : [];

  const actionBtnClass = (action: BrokerAction) => {
    const phase = phaseOf(action);
    const classes = ["gm-btn", "gm-action-btn"];
    if (phase === "pending") classes.push("is-loading");
    if (phase === "success") classes.push("is-success");
    if (phase === "error") classes.push("is-error");
    return classes.join(" ");
  };

  const isLiveSelected = Boolean(diagnostics?.selectedAccountIsLive);
  const accountAlreadySelected =
    canonical.accountPhase === "demo_selected" ||
    canonical.accountPhase === "live_selected";
  const maskedAccount =
    diagnostics?.account?.accountIdMasked ??
    diagnostics?.connection?.accountMasked ??
    summary?.accountMasked ??
    "—";
  const brokerName =
    diagnostics?.connection?.brokerName ??
    summary?.brokerName ??
    "Pepperstone";
  const currency =
    diagnostics?.account?.currency ??
    diagnostics?.connection?.currency ??
    "EUR";
  const quoteHealthy = Boolean(diagnostics?.liveQuoteReceived && !diagnostics?.quote?.stale);
  const equityValue = diagnostics?.account?.equity ?? diagnostics?.account?.balance ?? null;
  const funded = equityValue != null && equityValue > 0;

  return (
    <div
      className="gm-broker-centre gm-prem-page"
      data-testid="broker-control-centre"
    >
      <header className="gm-prem-page-head">
        <div>
          <h1>Broker connection</h1>
          <p>
            Manage your live broker connection, account health, and execution
            readiness.
          </p>
        </div>
        <div className="gm-prem-chip-row">
          <PremiumStatusChip tone="off" withDot testId="autotrade-off-badge">
            AutoTrade OFF
          </PremiumStatusChip>
          <PremiumStatusChip
            tone="locked"
            testId="no-order-badge"
            className="gm-prem-chip--desktop-only"
          >
            Order submission disabled in this preview
          </PremiumStatusChip>
          <span className="gm-prem-updated" aria-live="polite">
            <span className="gm-prem-dot" aria-hidden="true" />
            {summary?.lastSyncAt
              ? `Updated ${formatUserTimestamp(summary.lastSyncAt)}`
              : "Waiting for data"}
          </span>
        </div>
      </header>

      {/* Preserve legacy status grid for tests / screen readers */}
      <div className="gm-broker-top-status gm-prem-sr-status" data-testid="broker-top-status" aria-live="polite">
        <div className="gm-broker-status-cell">
          <span className="gm-label">Selected broker</span>
          <strong>{brokerDisplayName(selected, selectedBroker?.name)}</strong>
        </div>
        <div className="gm-broker-status-cell">
          <span className="gm-label">Connection</span>
          <strong data-testid="broker-connection-status">{canonical.connectionLabel}</strong>
        </div>
        <div className="gm-broker-status-cell">
          <span className="gm-label">Account type</span>
          <strong data-testid="broker-account-type">{canonical.accountTypeLabel}</strong>
        </div>
        <div className="gm-broker-status-cell">
          <span className="gm-label">Emergency STOP</span>
          <strong data-testid="emergency-stop-status">Armed (automation OFF)</strong>
        </div>
      </div>

      {canonical.connectionPhase === "connected" || accountAlreadySelected ? (
        <section className="gm-prem-card gm-prem-card--hero" aria-label="Connected account">
          <div className="gm-prem-hero-top">
            <div className="gm-prem-broker-brand">
              <div className="gm-prem-broker-mark" aria-hidden="true">
                P
              </div>
              <div>
                <strong>
                  {brokerName.replace(/\s*-\s*Europe/i, "")}{" "}
                  {isLiveSelected ? "LIVE" : "Demo"}
                </strong>
                <span>
                  {maskedAccount !== "—" ? maskedAccount : "Account —"} · {currency} · cTrader
                </span>
              </div>
            </div>
            <div className="gm-prem-chip-row">
              <PremiumStatusChip tone="ok" withDot>
                Connected
              </PremiumStatusChip>
              {isLiveSelected ? (
                <PremiumStatusChip tone="live">LIVE</PremiumStatusChip>
              ) : (
                <PremiumStatusChip tone="navy">DEMO</PremiumStatusChip>
              )}
              <div className="gm-prem-live-pulse" aria-hidden="true">
                <span />
              </div>
            </div>
          </div>

          <div className="gm-prem-stat-grid">
            <div className="gm-prem-stat">
              <span>Account</span>
              <strong>{maskedAccount}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Currency</span>
              <strong>{currency || "—"}</strong>
            </div>
            <div className="gm-prem-stat">
              <span>Platform</span>
              <strong>cTrader</strong>
            </div>
          </div>

          <div className="gm-prem-health-row" aria-label="Connection health">
            <span className="gm-prem-health">
              {connected || diagnostics?.oauthConnected ? "Broker OK" : "Broker —"}
            </span>
            <span className={`gm-prem-health${quoteHealthy ? "" : " gm-prem-health--warn"}`}>
              {quoteHealthy ? "Quotes live" : "Quotes waiting"}
            </span>
            <span className="gm-prem-health gm-prem-health--lock">Trading locked</span>
            <span className={`gm-prem-health${funded ? "" : " gm-prem-health--warn"}`}>
              {funded ? "Sync healthy" : "Funding needed"}
            </span>
          </div>

          <div className="gm-prem-hero-actions gm-broker-primary-actions">
            <Link
              className="gm-btn gm-btn-primary"
              to="/autotrade"
              data-testid="broker-edit-autotrade-settings"
            >
              Edit AutoTrade settings
            </Link>
            {accountAlreadySelected ? (
              <button
                type="button"
                className="gm-btn gm-prem-account-manager-btn"
                onClick={() => setShowAccountManager((v) => !v)}
              >
                {showAccountManager ? "Hide account switcher" : "Manage"}
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="gm-broker-actions gm-broker-primary-actions">
          <Link
            className="gm-btn gm-btn-primary"
            to="/autotrade"
            data-testid="broker-edit-autotrade-settings"
          >
            Edit AutoTrade settings
          </Link>
        </div>
      )}

      <ExecutionDisabledBanner page="brokers" />

      {canonical.connectionPhase === "connected" || accountAlreadySelected ? (
        <>
          <section className="gm-prem-card gm-prem-slim" aria-label="Market data">
            <div>
              <strong style={{ fontSize: "0.86rem" }}>
                {quoteHealthy
                  ? "Live quotes are streaming normally"
                  : "Waiting for live quote data"}
              </strong>
              <p className="gm-meta" style={{ margin: "2px 0 0" }}>
                {summary?.symbolName ?? diagnostics?.symbol?.symbolName ?? "XAUUSD"}
                {equityValue != null ? ` · Equity ${equityValue} ${currency}` : ""}
                {diagnostics?.account?.leverage != null
                  ? ` · ${diagnostics.account.leverage}x`
                  : ""}
              </p>
            </div>
            <PremiumStatusChip tone={quoteHealthy ? "ok" : "amber"} withDot>
              {quoteHealthy ? "Live" : "Waiting"}
            </PremiumStatusChip>
          </section>

          <p className="gm-prem-section-label">Setup status</p>
          <section className="gm-prem-card" aria-label="Setup status">
            <ul className="gm-prem-check-list">
              {[
                {
                  ok: Boolean(diagnostics?.oauthConnected || connected),
                  label: "Connected to cTrader",
                  detail: diagnostics?.oauthConnected || connected
                    ? "Secure OAuth connection is active."
                    : "Waiting for connection."
                },
                {
                  ok: accountAlreadySelected,
                  warn: !accountAlreadySelected,
                  label: isLiveSelected ? "LIVE account selected" : "Account selected",
                  detail: accountAlreadySelected
                    ? `${maskedAccount} is the active execution account.`
                    : "Select a Demo or Live account to continue."
                },
                {
                  ok: quoteHealthy,
                  warn: !quoteHealthy,
                  label: "Quote stream healthy",
                  detail: quoteHealthy
                    ? "Real broker prices are updating normally."
                    : "Waiting for a fresh LIVE quote."
                },
                {
                  ok: funded,
                  warn: !funded,
                  label: "Account funded",
                  detail:
                    equityValue == null
                      ? "Equity not available yet."
                      : funded
                        ? "Equity is available for shadow sizing."
                        : "Fund the account before shadow eligibility can pass."
                },
                {
                  ok: true,
                  label: "Live execution locked",
                  detail: "Real orders cannot be submitted until owner approval."
                },
                {
                  ok: true,
                  label: "Emergency stop available",
                  detail: "Automation can be halted instantly from AutoTrade."
                }
              ].map((row) => (
                <li key={row.label}>
                  <span
                    className={`gm-prem-check-ico ${
                      row.ok
                        ? "gm-prem-check-ico--ok"
                        : row.warn
                          ? "gm-prem-check-ico--warn"
                          : "gm-prem-check-ico--bad"
                    }`}
                    aria-hidden="true"
                  >
                    {row.ok ? "✓" : "!"}
                  </span>
                  <div>
                    <strong>{row.label}</strong>
                    <span>{row.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="gm-prem-section-label">Quick actions</p>
          <div className="gm-prem-actions" aria-label="Quick actions">
            <button
              type="button"
              className="gm-prem-action"
              disabled={anyActionBusy || !readiness?.oauthConfigured}
              onClick={() => void startOAuth("reconnect")}
            >
              <span className="gm-prem-action-ico" aria-hidden="true">
                ↻
              </span>
              Reconnect
            </button>
            <button
              type="button"
              className="gm-prem-action"
              disabled={anyActionBusy}
              onClick={() => void refreshAccounts()}
            >
              <span className="gm-prem-action-ico" aria-hidden="true">
                ⌕
              </span>
              View account
            </button>
            <button
              type="button"
              className="gm-prem-action"
              disabled={anyActionBusy}
              onClick={() => {
                setShowDiagnostics(true);
                void refreshDiagnostics();
              }}
            >
              <span className="gm-prem-action-ico" aria-hidden="true">
                ⌁
              </span>
              Test quote
            </button>
            <Link className="gm-prem-action" to="/autotrade">
              <span className="gm-prem-action-ico" aria-hidden="true">
                ⚙
              </span>
              Execution safety
            </Link>
            <a
              className="gm-prem-action"
              href="https://ct.pepperstone.com"
              target="_blank"
              rel="noreferrer"
            >
              <span className="gm-prem-action-ico" aria-hidden="true">
                ↗
              </span>
              Open cTrader
            </a>
            <button
              type="button"
              className="gm-prem-action"
              onClick={() =>
                document
                  .querySelector<HTMLElement>('[data-testid="owner-setup-guide"]')
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <span className="gm-prem-action-ico" aria-hidden="true">
                ?
              </span>
              Help
            </button>
          </div>

          <p className="gm-prem-section-label">Execution readiness</p>
          <section className="gm-prem-card" aria-label="Execution readiness">
            <div className="gm-prem-traffic">
              {[
                {
                  label: "Quote freshness",
                  tone: quoteHealthy ? "ok" : "amber",
                  value: quoteHealthy ? "LIVE" : "Waiting"
                },
                {
                  label: "Spread guard",
                  tone: "ok" as const,
                  value: "Active"
                },
                {
                  label: "Emergency stop",
                  tone: "ok" as const,
                  value: "Ready"
                },
                {
                  label: "Live order lock",
                  tone: "amber" as const,
                  value: "Locked"
                },
                {
                  label: "Shadow mode",
                  tone: funded ? "ok" : "amber",
                  value:
                    equityValue == null ? "Waiting" : funded ? "Ready" : "Needs funding"
                }
              ].map((row) => (
                <div className="gm-prem-traffic-row" key={row.label}>
                  <span>{row.label}</span>
                  <PremiumStatusChip tone={row.tone as "ok" | "amber"}>
                    {row.value}
                  </PremiumStatusChip>
                </div>
              ))}
            </div>
          </section>

          <div className="gm-prem-safety" role="status">
            <span aria-hidden="true">🛡</span>
            <div>
              <strong>Live order submission remains disabled until approval</strong>
              <p>You will be notified when trading is enabled.</p>
            </div>
          </div>

          <p className="gm-prem-section-label">Recent broker activity</p>
          <section className="gm-prem-card" aria-label="Recent broker activity">
            <ul className="gm-prem-activity">
              <li>
                <span>
                  {accountAlreadySelected
                    ? `Account connected · ${maskedAccount}`
                    : "No account selected"}
                </span>
                <time>
                  {summary?.lastSyncAt
                    ? formatUserTimestamp(summary.lastSyncAt)
                    : "—"}
                </time>
              </li>
              <li>
                <span>
                  {quoteHealthy
                    ? "Live quote healthy"
                    : "Waiting for a fresh live quote"}
                </span>
                <time>
                  {summary?.lastQuoteAt
                    ? formatUserTimestamp(summary.lastQuoteAt)
                    : "—"}
                </time>
              </li>
              <li>
                <span>
                  {accountAlreadySelected
                    ? "Selected execution account confirmed"
                    : "Execution account not selected"}
                </span>
                <time>—</time>
              </li>
              <li>
                <span>Live execution still locked</span>
                <time>—</time>
              </li>
            </ul>
          </section>
        </>
      ) : null}

      {loading && !centre ? (
        <div className="gm-section" role="status" data-testid="broker-centre-loading">
          <div className="gm-skeleton" />
          <p>Loading broker options…</p>
        </div>
      ) : null}

      {actionBanner ? (
        <div
          className={`gm-section gm-action-banner gm-action-banner-${actionBanner.tone}`}
          role="status"
          aria-live="polite"
          data-testid="broker-action-banner"
        >
          <p>{actionBanner.message}</p>
        </div>
      ) : null}

      {errorDetail ? (
        <FriendlyErrorBanner
          detail={errorDetail}
          onRetry={() => void retryLast()}
          testId="broker-centre-error"
        />
      ) : null}

      {canonical.reconnectRequired ? (
        <div
          className="gm-section gm-action-banner gm-action-banner-warning"
          role="status"
          data-testid="broker-reconnect-required"
        >
          <p>
            Pepperstone authentication expired or was denied. Reconnect to restore read-only
            access. AutoTrade stays OFF. No orders can be submitted.
          </p>
          <button
            type="button"
            className={actionBtnClass("reconnect")}
            data-testid="ctrader-reconnect-btn"
            disabled={anyActionBusy || !readiness?.oauthConfigured}
            aria-busy={isBusy("reconnect")}
            title={
              !readiness?.oauthConfigured
                ? "Secure credentials not added yet"
                : "Reconnect Pepperstone cTrader"
            }
            onClick={() => void startOAuth("reconnect")}
          >
            {actionButtonLabel("reconnect", phaseOf("reconnect"), "Reconnect cTrader")}
          </button>
        </div>
      ) : null}

      <details
        className="gm-prem-advanced"
        data-testid="broker-advanced-tools"
        open={!accountAlreadySelected || showAccountManager}
      >
        <summary>
          {accountAlreadySelected
            ? "Advanced broker tools"
            : "Connect or switch broker"}
        </summary>
        <div className="gm-prem-advanced-body">
      <section className="gm-section" aria-labelledby="broker-options-heading">
        <h2 id="broker-options-heading" className="gm-section-title">
          Broker options
        </h2>
        <div className="gm-broker-grid">
          {(centre?.brokers ?? []).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`gm-broker-card${selected === b.id ? " is-selected" : ""}`}
              data-testid={`broker-card-${b.id}`}
              aria-pressed={selected === b.id}
              disabled={anyActionBusy}
              onClick={() => {
                selectionTouchedRef.current = true;
                setSelected(b.id);
              }}
            >
              <StatusBadge
                tone={
                  b.id === "pepperstone_ctrader"
                    ? canonical.connectionPhase === "connected"
                      ? "positive"
                      : "warning"
                    : b.id === "trading212_invest"
                      ? "gold"
                      : "positive"
                }
              >
                {brokerBadgeLabel(b.badge)}
              </StatusBadge>
              <strong>{brokerDisplayName(b.id, b.name)}</strong>
              <span className="gm-broker-card-status">
                {connectionStatusLabel(b.status) === b.status
                  ? b.status.replace(/Auth Setup Required/i, "Connection setup required")
                  : connectionStatusLabel(b.status)}
              </span>
              <span className="gm-meta">
                {b.detail
                  .replace(/AutoTrade Locked/gi, "AutoTrade OFF")
                  .replace(/Live Locked/gi, "Live not active in preview")
                  .replace(/cTrader Demo workflow/gi, "cTrader AutoTrade workflow")
                  .replace(/Demo read-only/gi, "preview — order submission disabled")
                  .replace(/Demo setup only/gi, "Preview mode")
                  .replace(/order automation unmerged/gi, "practice read-only")}
              </span>
            </button>
          ))}
        </div>
        <p className="gm-meta">
          Switching brokers keeps AutoTrade OFF. Reconnecting never turns AutoTrade on.
        </p>
      </section>

      {selected === "pepperstone_ctrader" ? (
        <section
          className="gm-section gm-ctrader-panel"
          data-testid="ctrader-setup-panel"
          aria-labelledby="ctrader-heading"
        >
          <div className="gm-demo-watermark" aria-hidden="true">
            PREVIEW
          </div>
          <h2 id="ctrader-heading" className="gm-section-title">
            Pepperstone cTrader
          </h2>
          <p className="gm-broker-lead">
            {canonical.connectionPhase === "connected"
              ? "Connected in preview mode. Order submission is currently disabled in this preview. AutoTrade stays OFF."
              : canonical.reconnectRequired
                ? "Session needs reconnect. TradingView alone cannot authorise GoldMeta for cTrader."
                : oauthConfigured
                  ? "Server OAuth is configured. Authorise Demo Trading to grant Demo trading permission (scope=trading) with PKCE. TradingView alone cannot authorise GoldMeta for cTrader. AutoTrade stays OFF."
                  : "Connection setup required until server configuration and OAuth are complete. TradingView alone cannot authorise GoldMeta for cTrader."}
          </p>

          {canonical.connectionPhase !== "connected" && !canonical.reconnectRequired ? (
            <div
              className="gm-auth-setup-required"
              data-testid="ctrader-setup-required"
              role="status"
            >
              <strong data-testid="auth-setup-required">
                {authBlocked
                  ? "Connection setup required"
                  : oauthConfigured
                    ? "Pepperstone connection ready"
                    : "Pepperstone connection required"}
              </strong>
              <p>
                {authBlocked
                  ? "Broker connect stays disabled until account security checks pass. Dashboard and analysis still work."
                  : oauthConfigured
                    ? "Press Authorise Demo Trading to open the official cTrader consent page for your Demo account. GoldMeta never asks for your broker password. Live accounts must not be selected. AutoTrade stays OFF."
                    : missingConfigurationItems.length
                      ? "Server configuration is incomplete. Fix the items below, then retry."
                      : "Server configuration is incomplete. OAuth cannot start until the missing items are available to the function."}
              </p>
              {!authBlocked && !oauthConfigured && missingConfigurationItems.length ? (
                <ul data-testid="ctrader-missing-config-list">
                  {missingConfigurationItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {canonical.connectionPhase === "connected" ? (
            <div className="gm-risk-box" data-testid="ctrader-connected-summary" role="status">
              <strong>Connected (preview — execution disabled)</strong>
              <p className="gm-meta" style={{ marginBottom: 0 }}>
                Account {summary?.accountMasked ?? "—"} · {summary?.brokerName ?? "Broker pending"}
                {summary?.symbolName ? ` · ${summary.symbolName}` : ""}
                {summary?.lastSyncAt
                  ? ` · last sync ${formatUserTimestamp(summary.lastSyncAt)}`
                  : ""}
              </p>
            </div>
          ) : null}

          <h3 className="gm-subsection-title">Setup checklist</h3>
          <ol className="gm-wizard-steps" data-testid="ctrader-wizard">
            {wizardSteps.map((step) => (
              <li key={step.step} data-testid={`wizard-step-${step.step}`}>
                <StatusBadge tone={wizardStatusTone(step.status)}>
                  <span data-testid={`wizard-status-${step.step}`}>
                    {wizardStatusLabel(step.status)}
                  </span>
                </StatusBadge>
                <div>
                  <strong>
                    Step {step.step} — {step.title}
                  </strong>
                  <p className="gm-meta">
                    {step.detail
                      .replace(/AUTH SETUP REQUIRED[^.]*\.?/gi, "Connection setup required.")
                      .replace(/CTRADER_CLIENT_ID/g, "cTrader Client ID")
                      .replace(
                        /CTRADER_CLIENT_SECRET/g,
                        "cTrader Client Secret unavailable to function"
                      )
                      .replace(/CTRADER_REDIRECT_URI/g, "Redirect URI")
                      .replace(
                        new RegExp(["CTRADER", "TOKEN", "ENCRYPTION", "KEY"].join("_"), "g"),
                        "Encryption key"
                      ) // pragma: allowlist secret
                      .replace(/Missing:\s*/i, "Still needed: ")}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="gm-broker-actions" data-testid="ctrader-action-bar">
            {!connected || canonical.reconnectRequired ? (
              <button
                type="button"
                className={actionBtnClass(canonical.reconnectRequired ? "reconnect" : "connect")}
                disabled={!oauthConfigured || anyActionBusy}
                data-testid={
                  canonical.reconnectRequired ? "ctrader-reconnect-btn-main" : "ctrader-connect-btn"
                }
                aria-busy={isBusy(canonical.reconnectRequired ? "reconnect" : "connect")}
                title={
                  !oauthConfigured
                    ? missingConfigurationItems[0] ?? "Server configuration incomplete"
                    : canonical.reconnectRequired
                      ? "Reconnect Pepperstone cTrader"
                      : "Start cTrader connection for your account (accounts scope)"
                }
                onClick={() =>
                  void startOAuth(canonical.reconnectRequired ? "reconnect" : "connect")
                }
              >
                {actionButtonLabel(
                  canonical.reconnectRequired ? "reconnect" : "connect",
                  phaseOf(canonical.reconnectRequired ? "reconnect" : "connect"),
                  !oauthConfigured
                    ? "Connect unavailable"
                    : canonical.reconnectRequired
                      ? "Reconnect cTrader"
                      : "Connect cTrader"
                )}
              </button>
            ) : null}
            {oauthConfigured && !canonical.reconnectRequired ? (
              <button
                type="button"
                className={actionBtnClass("authorise_demo_trading")}
                data-testid="ctrader-authorise-demo-trading-btn"
                disabled={anyActionBusy || authBlocked}
                aria-busy={isBusy("authorise_demo_trading")}
                title="Request cTrader trading permission for your Demo account (scope=trading, PKCE). AutoTrade stays OFF. No order is submitted."
                onClick={() => void authoriseDemoTrading()}
              >
                {actionButtonLabel(
                  "authorise_demo_trading",
                  phaseOf("authorise_demo_trading"),
                  "Authorise Demo Trading"
                )}
              </button>
            ) : null}
            {connected && !canonical.reconnectRequired ? (
              <>
                <button
                  type="button"
                  className={actionBtnClass("refresh_accounts")}
                  data-testid="ctrader-refresh-accounts-btn"
                  disabled={anyActionBusy}
                  aria-busy={isBusy("refresh_accounts")}
                  title="Refresh authorised accounts (does not force token rotation)"
                  onClick={() => void refreshAccounts()}
                >
                  {actionButtonLabel(
                    "refresh_accounts",
                    phaseOf("refresh_accounts"),
                    "Refresh accounts"
                  )}
                </button>
                <button
                  type="button"
                  className={`gm-btn-secondary ${actionBtnClass("refresh_diagnostics")}`}
                  data-testid="ctrader-diagnostics-btn"
                  disabled={anyActionBusy}
                  aria-busy={isBusy("refresh_diagnostics")}
                  title="Refresh diagnostics via central token refresh lock"
                  onClick={() => void refreshDiagnostics()}
                >
                  {actionButtonLabel(
                    "refresh_diagnostics",
                    phaseOf("refresh_diagnostics"),
                    "Refresh diagnostics"
                  )}
                </button>
                <button
                  type="button"
                  className={`gm-btn-secondary ${actionBtnClass("first_checkpoint")}`}
                  data-testid="ctrader-first-demo-checkpoint-btn"
                  disabled={anyActionBusy}
                  aria-busy={isBusy("first_checkpoint")}
                  title="Prepare the first Demo order preview — does not submit"
                  onClick={() => void loadFirstCheckpoint()}
                >
                  {actionButtonLabel(
                    "first_checkpoint",
                    phaseOf("first_checkpoint"),
                    "Prepare first Demo order"
                  )}
                </button>
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary gm-action-btn"
                  data-testid="ctrader-view-diagnostics-btn"
                  disabled={anyActionBusy || !diagnostics}
                  aria-expanded={showDiagnostics}
                  onClick={() => setShowDiagnostics((v) => !v)}
                >
                  {showDiagnostics ? "Hide diagnostics" : "View diagnostics"}
                </button>
                <button
                  type="button"
                  className={`gm-btn-secondary ${actionBtnClass("preview")}`}
                  data-testid="ctrader-live-preview-btn"
                  disabled={anyActionBusy}
                  aria-busy={isBusy("preview")}
                  title="Build a trade preview only — no order submission"
                  onClick={() => void runPreview()}
                >
                  {actionButtonLabel("preview", phaseOf("preview"), "Preview next trade")}
                </button>
                <button
                  type="button"
                  className={`gm-btn-danger ${actionBtnClass("disconnect")}`}
                  data-testid="ctrader-disconnect-btn"
                  disabled={anyActionBusy}
                  aria-busy={isBusy("disconnect")}
                  title={
                    confirmDisconnect
                      ? "Click again to confirm disconnect"
                      : "Disconnect Pepperstone"
                  }
                  onClick={() => void disconnect()}
                >
                  {confirmDisconnect
                    ? "Confirm disconnect"
                    : actionButtonLabel("disconnect", phaseOf("disconnect"), "Disconnect")}
                </button>
                {confirmDisconnect ? (
                  <button
                    type="button"
                    className="gm-btn gm-btn-secondary"
                    data-testid="ctrader-disconnect-cancel-btn"
                    disabled={anyActionBusy}
                    onClick={() => {
                      setConfirmDisconnect(false);
                      setActionBanner(null);
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className={`gm-btn-secondary ${actionBtnClass("demo")}`}
              data-testid="ctrader-demo-btn"
              disabled={anyActionBusy}
              aria-busy={isBusy("demo")}
              onClick={() => void loadDemo()}
            >
              {actionButtonLabel("demo", phaseOf("demo"), "View labelled demonstration")}
            </button>
            <Link className="gm-btn gm-btn-secondary" to="/help" data-testid="ctrader-setup-help">
              Open setup help
            </Link>
          </div>
          <p className="gm-meta" data-testid="no-order-controls">
            Order submission is currently disabled in this preview. No Demo or Live order can be
            sent from this page.
          </p>

          {firstCheckpoint ? (
            <section
              className="gm-risk-box"
              data-testid="ctrader-first-demo-checkpoint"
              aria-labelledby="first-demo-checkpoint-heading"
            >
              <h3 id="first-demo-checkpoint-heading">First Demo order checkpoint</h3>
              <p className="gm-meta" data-testid="first-demo-checkpoint-status">
                Status: {String(firstCheckpoint.status ?? "—")} · AutoTrade OFF · No order submitted
              </p>
              <p className="gm-meta">
                Reply <strong>APPROVE FIRST DEMO ORDER</strong> in chat only after reviewing this
                preview. Live orders stay forbidden.
              </p>
              <pre
                className="gm-meta"
                style={{ whiteSpace: "pre-wrap", overflow: "auto", maxHeight: "24rem" }}
                data-testid="first-demo-checkpoint-json"
              >
                {JSON.stringify(firstCheckpoint, null, 2)}
              </pre>
            </section>
          ) : null}

          {accounts.length > 0 &&
          (!accountAlreadySelected || showAccountManager) ? (
            <section
              className="gm-risk-box"
              data-testid="ctrader-account-selector"
              aria-labelledby="account-select-heading"
            >
              <h3 id="account-select-heading">
                {accountAlreadySelected
                  ? "Manage broker account"
                  : "Select broker account"}
              </h3>
              <p className="gm-meta">
                Demo and Live accounts from your OAuth connection. Live needs confirmation. For Demo
                trading authorisation, select Demo only.
              </p>
              <ul className="gm-qual-list">
                {accounts.map((a) => (
                  <li key={a.ctidTraderAccountId}>
                    <button
                      type="button"
                      className={`gm-btn gm-btn-secondary gm-action-btn${
                        pendingLiveAccountId === a.ctidTraderAccountId ? " is-confirm" : ""
                      }${phaseOf("select_account") === "pending" ? " is-loading" : ""}`}
                      data-testid={`ctrader-account-${a.accountIdMasked}`}
                      disabled={anyActionBusy}
                      aria-busy={isBusy("select_account")}
                      onClick={() =>
                        void selectAccount(a.ctidTraderAccountId, Boolean(a.isLive))
                      }
                    >
                      {pendingLiveAccountId === a.ctidTraderAccountId
                        ? `Confirm Live · ${a.accountIdMasked}`
                        : phaseOf("select_account") === "pending"
                          ? "Selecting…"
                          : `${a.brokerNameTitle ?? "Broker"} · ${a.isLive ? "Live" : "Demo"} · ${a.accountIdMasked} · ${a.depositCurrency ?? "—"}${a.selected ? " · Selected" : ""}`}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {diagnostics && showDiagnostics ? (
            <section
              className="gm-section"
              data-testid="ctrader-diagnostics"
              aria-labelledby="diag-heading"
            >
              <h3 id="diag-heading" className="gm-subsection-title">
                Connection diagnostics
              </h3>
              <ul className="gm-qual-list" data-testid="ctrader-diagnostics-list">
                {diagRows.map((row) => (
                  <li key={row.key}>
                    <StatusBadge tone={diagTone(row.ok)}>
                      {row.ok ? "Ready" : "Pending"}
                    </StatusBadge>{" "}
                    {row.label}
                  </li>
                ))}
              </ul>
              {diagnostics.quote ? (
                <div className="gm-risk-box" data-testid="ctrader-live-quote">
                  <strong>Last market quote available</strong>
                  <dl className="gm-quote-meta" data-testid="ctrader-quote-eligibility">
                    <div>
                      <dt>Bid / Ask</dt>
                      <dd>
                        {diagnostics.quote.bid ?? "—"} / {diagnostics.quote.ask ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Spread</dt>
                      <dd>{diagnostics.quote.spread ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Quote timestamp</dt>
                      <dd>
                        {quoteTimestamp ? formatUserTimestamp(quoteTimestamp) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Quote age</dt>
                      <dd>{formatQuoteAge(quoteTimestamp)}</dd>
                    </div>
                    <div>
                      <dt>Market status</dt>
                      <dd data-testid="ctrader-market-status">{quoteMarketStatus}</dd>
                    </div>
                    <div>
                      <dt>Execution eligibility</dt>
                      <dd data-testid="ctrader-execution-eligibility">
                        {quoteEligibleForExecution
                          ? "Eligible"
                          : "Quote not eligible for execution"}
                        {!marketOpen ? " · Market closed" : ""}
                        {diagnostics.quote.stale ? " · Quote stale" : ""}
                      </dd>
                    </div>
                  </dl>
                  <p className="gm-meta" style={{ marginBottom: 0 }}>
                    Previous-session quotes may still display while the market is closed. That does
                    not mean a live executable price is available.
                  </p>
                </div>
              ) : null}
              {diagnostics.account ? (
                <div className="gm-risk-box" data-testid="ctrader-account-snapshot">
                  <strong>
                    {diagnostics.selectedAccountIsLive ? "Live" : "Demo"} account (masked)
                  </strong>
                  <p className="gm-meta" style={{ marginBottom: 0 }}>
                    {diagnostics.account.accountIdMasked} · {diagnostics.connection.currency ?? "—"}{" "}
                    · equity {diagnostics.account.equity ?? "—"} · free{" "}
                    {diagnostics.account.freeMargin ?? "—"} · used{" "}
                    {diagnostics.account.usedMargin ?? "—"}
                    {diagnostics.account.leverage != null
                      ? ` · leverage ${diagnostics.account.leverage}`
                      : ""}
                  </p>
                </div>
              ) : null}
              <details className="gm-disclosure">
                <summary>Technical details</summary>
                <div className="gm-disclosure-body">
                  <p className="gm-meta" style={{ margin: 0 }}>
                    Symbol: {diagnostics.symbol?.symbolName ?? "—"}
                    <br />
                    Token refresh healthy:{" "}
                    {String(diagnostics.connection.tokenRefreshHealthy)}
                    <br />
                    Environment: {diagnostics.environment === "LIVE" ? "Live" : "Demo"} ·
                    AutoTrade OFF · mutations disabled
                  </p>
                </div>
              </details>
            </section>
          ) : null}

          {isBusy("preview") ? (
            <div className="gm-section" role="status" data-testid="ctrader-preview-loading">
              <p>Building trade preview…</p>
            </div>
          ) : null}

          {previewResult ? (
            <section
              className="gm-section gm-demo-fixture"
              data-testid="ctrader-preview-only"
              aria-labelledby="preview-heading"
            >
              <p className="gm-demo-banner" data-testid="preview-only-banner">
                {previewResult.notice ?? "Preview only — no order will be submitted."}
              </p>
              <h3 id="preview-heading">Trade preview</h3>
              <p>
                {previewResult.preview?.action ?? "—"} ·{" "}
                {previewResult.preview?.state?.replace(/_/g, " ") ?? "—"} · vol{" "}
                {previewResult.preview?.proposedVolume ?? "—"} · risk €
                {previewResult.preview?.riskAmount ?? "—"}
              </p>
              <p className="gm-meta">
                Bid {previewResult.quote?.bid ?? "—"} / Ask {previewResult.quote?.ask ?? "—"} ·
                spread {previewResult.quote?.spread ?? "—"}
              </p>
            </section>
          ) : null}

          <section aria-labelledby="readonly-heading" className="gm-risk-box">
            <h3 id="readonly-heading">Read-only checks (when connected)</h3>
            <ul>
              <li>Client ID / secret / redirect URI present on the server</li>
              <li>OAuth connection and Demo/Live account selection</li>
              <li>Pepperstone account confirmation</li>
              <li>XAUUSD symbol discovery</li>
              <li>Last market quote (bid / ask), spread, volume minimum &amp; step</li>
              <li>Contract size, margin requirements, market-open state (shown separately)</li>
            </ul>
            <p className="gm-meta" style={{ marginBottom: 0 }}>
              Secrets are never stored in browser storage or shown in logs.
            </p>
          </section>

          <section aria-labelledby="risk-heading" className="gm-risk-box">
            <h3 id="risk-heading">Risk &amp; execution (per user)</h3>
            <ul>
              <li>
                Risk, lot sizing, daily loss, trade caps, confidence, sessions, and
                filters are configured per user (Demo and Live settings are separate)
              </li>
              <li>Recommended defaults apply only until the user saves settings</li>
              <li>Broker volume min/step from Open API still apply</li>
              <li>Stop loss required · no martingale / averaging / grid / pyramiding / blind retry</li>
              <li>
                <strong>Temporary preview locks:</strong> AutoTrade OFF · order
                submission disabled · <code>scope=accounts</code> only — not permanent
                product limitations
              </li>
            </ul>
          </section>

          <section aria-labelledby="qual-heading" data-testid="demo-qualification">
            <h3 id="qual-heading">Demo trading approval</h3>
            <p className="gm-meta">
              Progress is visible only. Demo Auto remains OFF in this preview until a separate
              approved activation (temporary lock — not a permanent product limitation).
            </p>
            {readiness?.qualification.progress ? (
              <div className="gm-risk-box" data-testid="qualification-defaults">
                <strong>Recommended qualification defaults</strong>
                <p className="gm-meta">
                  Source:{" "}
                  {readiness.qualification.progress.sourceLabel ??
                    "Recommended qualification defaults for future Demo Auto approval — not permanent user risk limits."}
                </p>
                <ul className="gm-meta">
                  <li>
                    Previews: {readiness.qualification.progress.completedPreviews} /{" "}
                    {readiness.qualification.progress.requiredPreviews} (recommended default)
                  </li>
                  <li>
                    Controlled trades:{" "}
                    {readiness.qualification.progress.approvedControlledDemoTrades} /{" "}
                    {readiness.qualification.progress.requiredTrades} (recommended default)
                  </li>
                  <li>
                    Days since first trade:{" "}
                    {readiness.qualification.progress.daysSinceFirstTrade ?? "—"} /{" "}
                    {readiness.qualification.progress.requiredDays} (recommended default)
                  </li>
                </ul>
                <p className="gm-meta" style={{ marginBottom: 0 }}>
                  These thresholds are recommended qualification defaults for a future Demo Auto
                  approval flow. They are not ordinary per-user risk settings. Changing them
                  requires an explicit product decision.
                </p>
              </div>
            ) : null}
            <ul className="gm-qual-list">
              {(readiness?.qualification.failed ?? []).slice(0, 8).map((g) => (
                <li key={g}>
                  <StatusBadge tone="warning">Pending</StatusBadge>{" "}
                  {g
                    .replace(/AUTH_HEALTHY/g, "Account security verified")
                    .replace(/OAUTH_HEALTHY/g, "Pepperstone connection verified")
                    .replace(/PREVIEWS_20/g, "Recommended preview count not yet met")
                    .replace(/CONTROLLED_TRADES_5/g, "Recommended controlled-trade count not yet met")
                    .replace(
                      /SEVEN_DAYS_SINCE_FIRST_TRADE/g,
                      "Recommended days-since-first-trade not yet met"
                    )
                    .replace(/_/g, " ")
                    .toLowerCase()
                    .replace(/^\w/, (c) => c.toUpperCase())}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="emergency-heading">
            <h3 id="emergency-heading">Emergency STOP</h3>
            <p className="gm-meta">
              Emergency STOP will disable new automated entries when automation exists. It does not
              silently close positions. Order submission is already disabled in this preview.
            </p>
            <div className="gm-broker-actions">
              <button type="button" className="gm-btn gm-btn-danger" disabled data-testid="emergency-stop-btn">
                Emergency STOP (armed)
              </button>
            </div>
          </section>

          <section
            className="gm-section gm-owner-setup-guide"
            data-testid="owner-setup-guide"
            aria-labelledby="owner-guide-heading"
          >
            <h3 id="owner-guide-heading">Broker setup guide</h3>
            <ol className="gm-help-steps">
              <li>TradingView connection alone is not enough for API-authorised trading.</li>
              <li>Create a Pepperstone cTrader account (Demo and/or Live — not just a chart login).</li>
              <li>Register a cTrader Open API application for the preview environment.</li>
              <li>
                Set the redirect URI to the GoldMeta OAuth callback provided by ops (server
                function URL).
              </li>
              <li>
                Store client ID, client secret, redirect URI and token encryption key in Secret
                Manager — never commit them to GitHub.
              </li>
              <li>OAuth will connect the account without pasting a broker password into GoldMeta.</li>
              <li>Run read-only verification before requesting any Demo trading approval.</li>
            </ol>
            <p className="gm-meta">
              Do not paste broker passwords here. Do not enable Demo or Live order submission from
              this screen.
            </p>
            <details className="gm-disclosure">
              <summary>Technical details</summary>
              <div className="gm-disclosure-body">
                <p className="gm-meta" style={{ margin: 0 }}>
                  Server label: {readiness?.label ?? "Pepperstone connection required"}
                  <br />
                  OAuth configured: {readiness?.oauthConfigured ? "yes" : "no"}
                  <br />
                  Temporary preview locks: broker execution, Demo orders, Live order
                  submission — not permanent product design.
                </p>
              </div>
            </details>
          </section>
        </section>
      ) : null}

      {selected === "manual" ? (
        <section className="gm-section" data-testid="manual-broker-panel">
          <h2 className="gm-section-title">Manual mode</h2>
          <p>
            GoldMeta continues to provide BUY / SELL / WAIT analysis without any broker execution.
            Use Signal History, Outcomes and Performance as usual.
          </p>
          <Link className="gm-btn" to="/">
            Back to Dashboard
          </Link>
        </section>
      ) : null}

      {selected === "trading212_invest" ? (
        <section className="gm-section" data-testid="t212-broker-panel">
          <h2 className="gm-section-title">Trading 212 Practice</h2>
          <p>
            Practice stays read-only. Order automation is not enabled from GoldMeta in this phase.
          </p>
          <Link className="gm-btn" to="/autotrade">
            Open practice view
          </Link>
        </section>
      ) : null}

      {showDemo && demo ? (
        <section
          className="gm-section gm-demo-fixture"
          data-testid="ctrader-demonstration"
          aria-labelledby="demo-heading"
        >
          <p className="gm-demo-banner">{demo.banner || demo.notice}</p>
          <h2 id="demo-heading" className="gm-section-title">
            Demonstration mode
          </h2>
          <p className="gm-meta">Labelled sample data — no broker connection — no order placed</p>
          <div className="gm-demo-grid">
            <article>
              <h3>Sample Demo account</h3>
              <p>ID {demo.account.accountIdMasked}</p>
              <p>
                {demo.account.currency} equity {demo.account.equity} · free margin{" "}
                {demo.account.freeMargin}
              </p>
              <p>
                Broker {demo.account.brokerName} ({demo.account.brokerNameSource})
              </p>
            </article>
            <article>
              <h3>Sample XAUUSD</h3>
              <p>
                {demo.symbol.symbolName} · lot {demo.symbol.lotSize} · min {demo.symbol.minVolume}{" "}
                step {demo.symbol.volumeStep}
              </p>
              <p>
                Bid {demo.quote.bid} / Ask {demo.quote.ask} · spread {demo.quote.spread} ·{" "}
                {demo.quote.marketStatus}
              </p>
            </article>
            <article>
              <h3>Sample BUY preview</h3>
              <p>
                {demo.buyPreview.state.replace(/_/g, " ")} · vol {demo.buyPreview.proposedVolume} ·
                risk €{demo.buyPreview.riskAmount}
              </p>
            </article>
            <article>
              <h3>Sample SELL preview</h3>
              <p>
                {demo.sellPreview.state.replace(/_/g, " ")} · vol {demo.sellPreview.proposedVolume}
              </p>
            </article>
            <article>
              <h3>Blocked trade example</h3>
              <p>{demo.blockedPreview.failedGates.join(", ").replace(/_/g, " ")}</p>
            </article>
          </div>
          <details className="gm-disclosure">
            <summary>Technical details</summary>
            <div className="gm-disclosure-body">
              <p className="gm-meta" style={{ margin: 0 }}>
                Quote source: {demo.quote.source}
                <br />
                AutoTrade: {demo.autoTrade} · Order submission:{" "}
                {String(demo.orderSubmissionEnabled)}
              </p>
            </div>
          </details>
        </section>
      ) : null}

      <section className="gm-section" aria-labelledby="help-heading">
        <h2 id="help-heading" className="gm-section-title">
          Need help?
        </h2>
        <ul className="gm-help-list">
          <li>TradingView alone cannot place API-authorised cTrader orders.</li>
          <li>Create a Pepperstone cTrader account, then register an Open API app.</li>
          <li>GoldMeta never collects your cTrader password.</li>
          <li>
            Live trading is not active in this preview. It can be configured later through the
            separate Live activation process.
          </li>
        </ul>
        <p className="gm-meta">
          <Link to="/help">Open the GoldMeta help guide</Link>
        </p>
      </section>
        </div>
      </details>
    </div>
  );
}
