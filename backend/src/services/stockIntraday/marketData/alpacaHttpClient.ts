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

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader
            ? Math.max(1_000, Number(retryAfterHeader) * 1000)
            : 5_000 * attempt;
          this.state.rateLimitedUntil = this.nowFn() + retryAfterMs;
          this.recordFailure("HTTP_429");
          throw new AlpacaHttpError("ALPACA_RATE_LIMITED", 429, retryAfterMs);
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
        if (error instanceof AlpacaHttpError && error.status === 429) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          this.recordFailure("TIMEOUT");
          if (attempt > this.config.maxRetries) {
            throw new AlpacaHttpError("ALPACA_TIMEOUT", 408);
          }
          continue;
        }
        if (error instanceof AlpacaHttpError) {
          if (attempt > this.config.maxRetries) throw error;
          continue;
        }
        this.recordFailure("NETWORK");
        if (attempt > this.config.maxRetries) {
          throw new AlpacaHttpError("ALPACA_NETWORK_ERROR", 0);
        }
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
