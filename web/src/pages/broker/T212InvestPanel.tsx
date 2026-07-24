/**
 * Trading 212 General Invest — owner-only read-only + paper panel.
 * No credential paste. No real order submission. AutoTrade stays OFF.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api";
import { describeClientError } from "../../lib/errors";
import { FriendlyErrorBanner } from "../../components/FriendlyErrorBanner";
import { StatusBadge } from "../../components/ui/primitives";

type Props = {
  api: ApiClient;
  isOwner: boolean;
};

export function T212InvestPanel({ api, isOwner }: Props) {
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(
    null
  );
  const [portfolio, setPortfolio] = useState<Record<string, unknown> | null>(null);
  const [paper, setPaper] = useState<Record<string, unknown> | null>(null);
  const [watchlist, setWatchlist] = useState<Array<Record<string, unknown>>>([]);
  const [searchQ, setSearchQ] = useState("");
  const [candidates, setCandidates] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isOwner) return;
    setBusy(true);
    setErrorDetail(null);
    try {
      const [p, pap, wl] = await Promise.all([
        api.t212InvestPortfolio(),
        api.t212InvestPaper(),
        api.t212InvestWatchlist()
      ]);
      setPortfolio(p.portfolio);
      setPaper(pap.paper);
      setWatchlist(wl.items ?? []);
    } catch (e) {
      setErrorDetail(
        describeClientError(e, "Could not load Trading 212 General Invest read-only data.")
      );
    } finally {
      setBusy(false);
    }
  }, [api, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isOwner) {
    return (
      <section className="gm-section" data-testid="t212-broker-panel">
        <h2 className="gm-section-title">Trading 212 General Invest</h2>
        <p>
          Owner broker data is private. Approved users cannot view the owner’s Trading 212 account.
        </p>
        <StatusBadge tone="neutral">Owner only</StatusBadge>
      </section>
    );
  }

  const positions = (portfolio?.positions as Array<Record<string, unknown>> | undefined) ?? [];
  const paperPositions = (paper?.positions as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <section className="gm-section gm-t212-invest" data-testid="t212-broker-panel">
      <h2 className="gm-section-title">Trading 212 General Invest</h2>
      <p className="gm-broker-lead">
        Read-only stocks and ETFs. Paper trading only. AutoTrade remains OFF. No real Trading 212
        order can be submitted from GoldMeta.
      </p>
      <div className="gm-broker-status-row">
        <span className="gm-badge gm-badge-off" data-testid="t212-autotrade-off">
          AutoTrade OFF
        </span>
        <span className="gm-badge gm-badge-demo" data-testid="t212-paper-only">
          Paper only
        </span>
        <span className="gm-badge gm-badge-warn" data-testid="t212-no-orders">
          Orders disabled
        </span>
      </div>

      {errorDetail ? (
        <FriendlyErrorBanner
          detail={errorDetail}
          onRetry={() => void load()}
          testId="t212-invest-error"
        />
      ) : null}

      <section className="gm-risk-box" aria-labelledby="t212-conn-heading">
        <h3 id="t212-conn-heading">Connection</h3>
        {busy ? <p role="status">Refreshing…</p> : null}
        <p>
          Status: <strong>{String(portfolio?.connectionStatus ?? "—")}</strong>
          {" · "}
          Account: <strong>{String(portfolio?.accountIdMasked ?? "—")}</strong>
          {" · "}
          Type: <strong>GENERAL_INVEST</strong>
        </p>
        <p className="gm-meta">
          Cash {String(portfolio?.availableCash ?? "—")} · Invested{" "}
          {String(portfolio?.investedValue ?? "—")} · Portfolio{" "}
          {String(portfolio?.portfolioValue ?? "—")} · Currency{" "}
          {String(portfolio?.currency ?? "—")}
        </p>
        <p className="gm-meta" data-testid="t212-last-sync">
          Last sync: {String(portfolio?.lastSyncAt ?? "—")}
          {portfolio?.stale ? " · stale data" : ""}
        </p>
        <p className="gm-meta">
          Store read-only API credentials in Secret Manager as T212_API_KEY, T212_API_SECRET and
          T212_ENVIRONMENT. Never paste keys into this page, chat or GitHub.
        </p>
      </section>

      <section aria-labelledby="t212-pos-heading">
        <h3 id="t212-pos-heading">Owned positions (read-only)</h3>
        {positions.length === 0 ? (
          <p className="gm-meta">No positions returned (or credentials not connected yet).</p>
        ) : (
          <ul className="gm-t212-list" data-testid="t212-positions">
            {positions.map((p) => (
              <li key={String(p.ticker)}>
                <strong>{String(p.ticker)}</strong> {String(p.name ?? "")} · qty{" "}
                {String(p.quantity ?? "—")} · avg {String(p.averagePrice ?? "—")} · px{" "}
                {String(p.currentPrice ?? "—")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="t212-search-heading">
        <h3 id="t212-search-heading">Search stocks &amp; ETFs</h3>
        <form
          className="gm-t212-search"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                const result = await api.t212InvestSearch(searchQ);
                setCandidates(result.candidates ?? []);
              } catch (err) {
                setErrorDetail(describeClientError(err, "Search failed."));
              }
            })();
          }}
        >
          <label htmlFor="t212-search-q">Instrument</label>
          <input
            id="t212-search-q"
            data-testid="t212-search-input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="e.g. VWCE or Apple"
          />
          <button type="submit" className="gm-btn" data-testid="t212-search-btn">
            Search
          </button>
        </form>
        <ul className="gm-t212-list" data-testid="t212-search-results">
          {candidates.map((c) => (
            <li key={String(c.ticker)}>
              <strong>{String(c.ticker)}</strong> {String(c.name)} · {String(c.currency ?? "")} ·{" "}
              {c.allowed ? "allowed" : `rejected (${String(c.rejectReason)})`}
              {c.allowed ? (
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary"
                  data-testid={`t212-add-wl-${String(c.ticker)}`}
                  onClick={() => {
                    void api
                      .t212InvestWatchlistAdd({
                        ticker: String(c.ticker),
                        name: String(c.name),
                        currency: (c.currency as string | null) ?? null
                      })
                      .then((r) => setWatchlist(r.items ?? []))
                      .catch((err) =>
                        setErrorDetail(describeClientError(err, "Could not update watchlist."))
                      );
                  }}
                >
                  Add to watchlist
                </button>
              ) : null}
              {c.allowed ? (
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary"
                  data-testid={`t212-preview-${String(c.ticker)}`}
                  onClick={() => {
                    void api
                      .t212InvestPreview({
                        ticker: String(c.ticker),
                        name: String(c.name),
                        currentPrice: 100,
                        signalScore: 72,
                        marketOpen: true,
                        ownedQuantity: 0
                      })
                      .then((r) => setPreview(r.preview))
                      .catch((err) =>
                        setErrorDetail(describeClientError(err, "Preview failed."))
                      );
                  }}
                >
                  Paper preview
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="t212-wl-heading">
        <h3 id="t212-wl-heading">Watchlist</h3>
        {watchlist.length === 0 ? (
          <p className="gm-meta">Empty — add allowed stocks or ETFs from search.</p>
        ) : (
          <ul className="gm-t212-list" data-testid="t212-watchlist">
            {watchlist.map((w) => (
              <li key={String(w.ticker)}>
                <strong>{String(w.ticker)}</strong> {String(w.name)}
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary"
                  onClick={() => {
                    void api
                      .t212InvestWatchlistRemove(String(w.ticker))
                      .then((r) => setWatchlist(r.items ?? []))
                      .catch((err) =>
                        setErrorDetail(describeClientError(err, "Could not remove watchlist item."))
                      );
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {preview ? (
        <section className="gm-risk-box" data-testid="t212-preview" aria-labelledby="t212-prev-h">
          <h3 id="t212-prev-h">Stock preview</h3>
          <p>
            <strong>{String(preview.action)}</strong> · confidence {String(preview.confidence)} ·
            price {String(preview.currentPrice)}
          </p>
          <p className="gm-meta">{String(preview.disclaimer)}</p>
          <ul>
            {((preview.reasons as string[]) ?? []).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="t212-paper-heading">
        <h3 id="t212-paper-heading">Paper portfolio</h3>
        <p className="gm-meta" data-testid="t212-paper-disclaimer">
          {String(paper?.disclaimer ?? "Paper preview only — no Trading 212 order will be submitted.")}
        </p>
        <p>
          Cash {String(paper?.cash ?? "—")} · Equity {String(paper?.equity ?? "—")} · Realised{" "}
          {String(paper?.realisedPnl ?? "—")} · Unrealised {String(paper?.unrealisedPnl ?? "—")}
        </p>
        <ul className="gm-t212-list">
          {paperPositions.map((p) => (
            <li key={String(p.ticker)}>
              {String(p.ticker)} · qty {String(p.quantity)} · avg {String(p.avgCost)}
            </li>
          ))}
        </ul>
        <div className="gm-broker-actions">
          <button
            type="button"
            className="gm-btn"
            data-testid="t212-paper-buy"
            onClick={() => {
              void api
                .t212InvestPaperBuy({
                  ticker: "PAPER_DEMO_EQ",
                  name: "Paper demo equity",
                  quantity: 1,
                  price: 100,
                  marketOpen: true,
                  priceTimestamp: new Date().toISOString(),
                  signalRef: `manual-${Date.now()}`
                })
                .then((r) => setPaper((r.paper as Record<string, unknown>) ?? null))
                .catch((err) => setErrorDetail(describeClientError(err, "Paper BUY failed.")));
            }}
          >
            Simulate paper BUY
          </button>
          <button
            type="button"
            className="gm-btn gm-btn-danger"
            data-testid="t212-paper-stop"
            onClick={() => {
              void api
                .t212InvestPaperEmergencyStop()
                .then((r) => setPaper(r.paper))
                .catch((err) =>
                  setErrorDetail(describeClientError(err, "Emergency STOP failed."))
                );
            }}
          >
            Paper Emergency STOP
          </button>
        </div>
      </section>
    </section>
  );
}
