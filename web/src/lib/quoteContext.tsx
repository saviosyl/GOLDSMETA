import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction
} from "react";
import type { QuoteFreshness } from "./liveQuote";

export type ShellQuote = {
  price: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  fresh?: boolean;
  freshness?: QuoteFreshness;
  source?: "broker" | "decision";
  bid?: number | null;
  ask?: number | null;
  unavailable?: boolean;
  /** Broker schedule status when known. */
  marketStatus?: "OPEN" | "CLOSED" | "UNKNOWN";
};

type QuoteContextValue = {
  quote: ShellQuote | null;
  setQuote: (next: SetStateAction<ShellQuote | null>) => void;
};

const QuoteContext = createContext<QuoteContextValue | null>(null);

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [quote, setQuoteState] = useState<ShellQuote | null>(null);
  const setQuote = useCallback((next: SetStateAction<ShellQuote | null>) => {
    setQuoteState(next);
  }, []);
  const value = useMemo(() => ({ quote, setQuote }), [quote, setQuote]);
  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

export function useShellQuote() {
  const ctx = useContext(QuoteContext);
  if (!ctx) {
    return {
      quote: null as ShellQuote | null,
      setQuote: (_next: SetStateAction<ShellQuote | null>) => undefined
    };
  }
  return ctx;
}
