# V4 historical XAUUSD importer

LIVE shadow collection does **not** require a historical archive. This importer exists so real chronological bars can be validated for out-of-sample research later.

## Required fields

| Field | Notes |
| --- | --- |
| `symbol` | Must be `XAUUSD` |
| `timeframe` | `1`, `5`, `15`, or `60` (minutes) |
| `timestamp` | ISO-8601 UTC |
| `open` / `high` / `low` / `close` | Finite numbers; OHLC consistency checked |
| `volume` or `tickVolume` | Optional but preferred |
| `timezone` | Must be `UTC` |
| `provider` | Data vendor / broker label |

## CSV format

```
symbol,timeframe,timestamp,open,high,low,close,volume,tickVolume,timezone,provider
XAUUSD,15,2025-01-02T08:00:00.000Z,2650.10,2651.40,2649.80,2650.90,120,120,UTC,your_provider
```

## JSON format

```json
{
  "meta": { "symbol": "XAUUSD", "timezone": "UTC", "provider": "your_provider" },
  "bars": [
    {
      "symbol": "XAUUSD",
      "timeframe": "15",
      "timestamp": "2025-01-02T08:00:00.000Z",
      "open": 2650.1,
      "high": 2651.4,
      "low": 2649.8,
      "close": 2650.9,
      "volume": 120,
      "tickVolume": 120,
      "timezone": "UTC",
      "provider": "your_provider"
    }
  ]
}
```

## Import

```bash
cd backend
npx tsx scripts/importV4HistoricalData.ts --file ../data/xauusd_15m.csv --out ../data/validated_15m.json
```

Validation reports: missing fields, duplicates (idempotent skip), out-of-order timestamps, gaps, price jumps, timezone errors.

`--persist` is intentionally disabled until an authorised archive path is approved. Do not fabricate bars or performance results.

## Obtaining data

Suitable sources (examples only — verify licence terms):

1. Broker historical export for XAUUSD (1m/5m/15m/1h), convert to UTC.
2. TradingView / Pine export of confirmed bars (label provider accurately).
3. Paid market-data vendors (do not purchase without approval).

Required coverage for meaningful OOS work:

- 1m or 5m for lifecycle resolution
- 15m for setup logic
- 60m for regime context
