/**
 * Keeps the shell XAUUSD price live from the backend Pepperstone quote service.
 * Mounted once for authenticated sessions — independent of page / plan / AutoTrade.
 */
import { useLiveXauusdQuote } from "../lib/useLiveXauusdQuote";

export function LiveQuoteBridge() {
  useLiveXauusdQuote({ enabled: true });
  return null;
}
