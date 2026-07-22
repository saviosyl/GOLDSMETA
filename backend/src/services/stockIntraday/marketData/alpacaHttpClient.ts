/**
 * Serverless-safe Alpaca Market Data HTTP client.
 * No permanent WebSocket. Injectable fetch for deterministic tests.
 */

import { redactSecrets } from "../redact";
import type { AlpacaMarketDataConfig } from "./alpacaConfig";

export class AlpacaHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "AlpacaHttpError";
  }
}

export class AlpacaCircuitOpenError extends Error {
  constructor(message = "ALPACA_CIRCUIT_OPEN") {
    super(message);
    this.name = "AlpacaCircuitOpenError";
  }
}

export interface AlpacaHttpClientState {
  consecutiveFailures: number;
  circuitOpenUntil: number | null;
  rateLimitedUntil: number | null;
  requestCountWindow: number;
  windowStartedAt: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
}

/** Parse Retry-After as numeric seconds or HTTP-date. */
export function parseRetryAfterMs(header: string | null, nowMs = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(1_000, Number(trimmed) * 1000);
  }
  const when = Date.parse(trimmed);
  if (Number.isFinite(when)) {
    return Math.max(1_000, when - nowMs);
  }
  return null;
}

function backoffMs(attempt: number, baseMs = 250, capMs = 8_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.2));
  return exp + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AlpacaHttpClient {
  private state: AlpacaHttpClientState = {
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    rateLimitedUntil: null,
    requestCountWindow: 0,
    windowStartedAt: Date.now(),
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorCode: null
  };

  constructor(
    private readonly config: AlpacaMarketDataConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nowFn: () => number = () => Date.now()
  ) {}

  getState(): AlpacaHttpClientState {
    return { ...this.state };
  }

  /** Test helper — force circuit / rate-limit state. */
  setStateForTests(patch: Partial<AlpacaHttpClientState>): void {
    this.state = { ...this.state, ...patch };
  }

  async getJson<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
    this.assertCircuit();
    this.bumpWindow();
    if (this.state.rateLimitedUntil && this.nowFn() < this.state.rateLimitedUntil) {
      throw new AlpacaHttpError("ALPACA_RATE_LIMITED", 429, this.state.rateLimitedUntil - this.nowFn());
    }

    const url = new URL(path.startsWith("http") ? path : `${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== "") url.searchParams.set(key, value);
    }

    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.config.maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(url.toString(), {
          method: "GET",
          headers: {
            "APCA-API-KEY-ID": this.config.credentials.apiKey,
            "APCA-API-SECRET-KEY": this.config.credentials.apiSecret,
            Accept: "application/json"
          },
          signal: controller.signal
        });
        clearTimeout(timer);

        if (response.status === 401 || response.status === 403) {
          this.recordFailure(`HTTP_${response.status}`);
          throw new AlpacaHttpError(`ALPACA_HTTP_${response.status}`, response.status);
        }

        if (response.status === 429) {
          const retryAfterMs =
            parseRetryAfterMs(response.headers.get("retry-after"), this.nowFn()) ??
            5_000 * attempt;
          this.state.rateLimitedUntil = this.nowFn() + retryAfterMs;
          this.recordFailure("HTTP_429");
          throw new AlpacaHttpError("ALPACA_RATE_LIMITED", 429, retryAfterMs);
        }

        if (response.status >= 500) {
          this.recordFailure(`HTTP_${response.status}`);
          const err = new AlpacaHttpError(`ALPACA_HTTP_${response.status}`, response.status);
          if (attempt > this.config.maxRetries) throw err;
          await sleep(backoffMs(attempt));
          lastError = err;
          continue;
        }

        if (!response.ok) {
          this.recordFailure(`HTTP_${response.status}`);
          throw new AlpacaHttpError(`ALPACA_HTTP_${response.status}`, response.status);
        }

        const json = (await response.json()) as T;
        this.recordSuccess();
        return json;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (error instanceof AlpacaHttpError) {
          // Do not retry auth or rate-limit (caller respects rateLimitedUntil).
          if (error.status === 401 || error.status === 403 || error.status === 429) {
            throw error;
          }
          if (error.status >= 500 && attempt <= this.config.maxRetries) {
            await sleep(backoffMs(attempt));
            continue;
          }
          if (attempt > this.config.maxRetries) throw error;
          continue;
        }
        if (error instanceof Error && error.name === "AbortError") {
          this.recordFailure("TIMEOUT");
          if (attempt > this.config.maxRetries) {
            throw new AlpacaHttpError("ALPACA_TIMEOUT", 408);
          }
          await sleep(backoffMs(attempt));
          continue;
        }
        this.recordFailure("NETWORK");
        if (attempt > this.config.maxRetries) {
          throw new AlpacaHttpError("ALPACA_NETWORK_ERROR", 0);
        }
        await sleep(backoffMs(attempt));
      }
    }
    void redactSecrets;
    throw lastError instanceof Error ? lastError : new AlpacaHttpError("ALPACA_UNKNOWN", 0);
  }

  private assertCircuit(): void {
    if (this.state.circuitOpenUntil && this.nowFn() < this.state.circuitOpenUntil) {
      throw new AlpacaCircuitOpenError();
    }
    if (this.state.circuitOpenUntil && this.nowFn() >= this.state.circuitOpenUntil) {
      this.state.circuitOpenUntil = null;
      this.state.consecutiveFailures = 0;
    }
  }

  private bumpWindow(): void {
    const now = this.nowFn();
    if (now - this.state.windowStartedAt > 60_000) {
      this.state.windowStartedAt = now;
      this.state.requestCountWindow = 0;
    }
    this.state.requestCountWindow += 1;
  }

  private recordSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.circuitOpenUntil = null;
    this.state.lastSuccessAt = new Date(this.nowFn()).toISOString();
    this.state.lastErrorCode = null;
  }

  private recordFailure(code: string): void {
    this.state.consecutiveFailures += 1;
    this.state.lastErrorAt = new Date(this.nowFn()).toISOString();
    this.state.lastErrorCode = code;
    if (this.state.consecutiveFailures >= this.config.circuitFailureThreshold) {
      this.state.circuitOpenUntil = this.nowFn() + this.config.circuitCooldownMs;
    }
  }
}
