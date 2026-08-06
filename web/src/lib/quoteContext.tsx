import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type ShellQuote = {
  price: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  fresh?: boolean;
};

type QuoteContextValue = {
  quote: ShellQuote | null;
  setQuote: (next: ShellQuote | null) => void;
};

const QuoteContext = createContext<QuoteContextValue | null>(null);

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [quote, setQuote] = useState<ShellQuote | null>(null);
  const value = useMemo(() => ({ quote, setQuote }), [quote]);
  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

export function useShellQuote() {
  const ctx = useContext(QuoteContext);
  if (!ctx) {
    return {
      quote: null,
      setQuote: () => undefined
    };
  }
  return ctx;
}
