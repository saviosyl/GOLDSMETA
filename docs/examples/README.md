# Examples

## TradingView intraday payloads (Issue #50)

- `tradingview-intraday-strategy-payload.json` — full STRATEGY alert (`metadata.alertKind = STRATEGY`)
- `tradingview-intraday-quote-payload.json` — lightweight 1m QUOTE alert (`metadata.alertKind = QUOTE`)

Validated by `backend/tests/unit/tradingview/intradayPayload.test.ts`.

## GitHub Actions

Copy `docs/examples/github-actions-backend.yml` to `.github/workflows/backend.yml` after granting the `workflow` scope on your PAT, or add it via the GitHub UI.
