import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  deriveAutoTradeHeaderStatus,
  type AutoTradeHeaderStatus
} from "../lib/autoTradeHeaderStatus";
import type { AutoTradeStatus } from "../lib/autoTradeTypes";
import type { QualificationPublicView } from "../lib/broker/qualificationTypes";

const POLL_MS = 45_000;

export function useAutoTradeHeaderStatus(): AutoTradeHeaderStatus {
  const { api, user } = useAuth();
  const [qualification, setQualification] = useState<QualificationPublicView | null>(null);
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !api) {
      setLoading(false);
      return;
    }
    try {
      const [qualResult, statusResult] = await Promise.allSettled([
        typeof api.getAutoTradeQualification === "function"
          ? api.getAutoTradeQualification()
          : Promise.resolve(null),
        typeof api.autoTradeStatus === "function"
          ? api.autoTradeStatus()
          : Promise.resolve(null)
      ]);
      if (qualResult.status === "fulfilled") {
        setQualification(qualResult.value);
      }
      if (statusResult.status === "fulfilled") {
        setStatus(statusResult.value);
      }
    } catch {
      /* keep last good status */
    } finally {
      setLoading(false);
    }
  }, [api, user]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return deriveAutoTradeHeaderStatus({ qualification, status, loading });
}
