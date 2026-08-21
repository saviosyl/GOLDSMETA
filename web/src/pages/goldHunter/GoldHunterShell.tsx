import { createContext, useContext } from "react";
import type { GoldHunterStatusResponse } from "../../lib/api";
import { GoldHunterTestPage } from "./GoldHunterTestPage";

type GhCtx = {
  status: GoldHunterStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const GoldHunterContext = createContext<GhCtx | null>(null);

/**
 * Legacy Gold Hunter child pages still import this hook. The new V6 test
 * console intentionally replaces the old nested dashboard/control/monitor/
 * performance UI, so those child pages are no longer rendered.
 */
export function useGoldHunter(): GhCtx {
  const ctx = useContext(GoldHunterContext);
  if (!ctx) throw new Error("Legacy Gold Hunter context is not active in test-console mode");
  return ctx;
}

export function formatEur(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}€${n.toFixed(digits)}`;
}

/**
 * Temporary single-page V6 testing experience.
 * Trading strategy, risk, execution and broker code are untouched.
 */
export function GoldHunterShell() {
  return <GoldHunterTestPage />;
}

export function GhStatusTone({ value }: { value: string }) {
  const v = value.toUpperCase();
  let cls = "gh-badge--muted";
  if (/LIVE|CONNECTED|VALID|READY|ACTIVE|NORMAL|OPEN/.test(v)) cls = "gh-badge--demo";
  if (/STALE|WAITING|PAUSED|LIMITED|UNKNOWN|CLOSED/.test(v)) cls = "gh-badge--warn";
  if (/HARD|DISCONNECTED|HALTED|INVALID|CROSSED|OFF/.test(v)) cls = "gh-badge--danger";
  return <span className={`gh-badge ${cls}`}>{value}</span>;
}
