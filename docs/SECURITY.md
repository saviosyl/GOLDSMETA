# Security

GoldMeta handles trading analysis data, webhook URLs, device tokens, and user journal entries. Treat the system as sensitive even though it does not execute trades.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Security principles

1. No broker credentials in GoldMeta MVP.
2. No automatic trade execution.
3. No TradingView passwords or session scraping.
4. Secrets stay on the backend.
5. Webhooks are validated, deduplicated, and rate-limited.
6. Users can access only their own data.
7. Logs must not contain secrets or private payload tokens.

## Webhook protection

TradingView webhook requests cannot include Firebase user authentication, so protect the endpoint with layered controls:

- Opaque random `webhookId` in the path.
- Optional payload secret or HMAC if your alert source supports it.
- Strict JSON schema validation.
- Symbol allowlist: MVP accepts XAUUSD only.
- Timeframe allowlist.
- Timestamp freshness window.
- Replay protection by `eventId`.
- Deduplication by symbol, timeframe, bar time, and source.
- Per-user and per-webhook rate limits.
- Structured audit events.

Reject invalid payloads safely. Do not try to repair malformed market data.

## Secret handling

Store secrets in Firebase/Google Secret Manager or equivalent secure configuration:

- OpenAI API keys
- Webhook signing secrets
- Backend service credentials
- Apple private keys
- Operational tokens

Never store these in:

- Pine Script
- iOS source code
- `Info.plist`
- Git history
- TradingView alert names
- Client-readable Firestore documents

## iOS security

- Use Firebase Auth ID tokens for backend APIs.
- Store local auth/session material with iOS Keychain where applicable.
- Avoid showing full webhook URLs in screenshots or support logs.
- Cache decisions locally only as needed.
- Provide account data export and deletion flows.
- Do not include OpenAI or Firebase Admin credentials in the app.

## Firestore rules

Rules should enforce ownership:

- `users/{userId}/decisions/*`: readable by the owning user.
- `users/{userId}/journalEntries/*`: readable/writable by the owning user.
- `rawEvents`, `marketSnapshots`, `auditEvents`: backend write-only unless explicitly exposed.
- `system/configurations`: read-only if clients need display metadata.

Backends should use Admin SDK with least-privilege runtime service accounts where possible.

## AI safety boundary

AI can explain a deterministic decision and flag conflicts. It must not:

- Invent market data.
- Override hard safety guards.
- Claim certainty or guaranteed profitability.
- Treat confidence as a win probability.
- Recommend trades when required inputs are missing and rules say WAIT.

## Logging

Log:

- Event IDs
- User IDs or hashed identifiers
- Validation outcomes
- Decision IDs
- Error categories

Avoid logging:

- Full webhook URLs
- Payload secrets
- FCM tokens
- API keys
- Private journal details unless required for debugging and consented

## Incident response checklist

1. Disable affected webhook IDs or rotate secrets.
2. Revoke exposed API keys.
3. Review logs for replay or abnormal rates.
4. Notify affected users if personal data may have been exposed.
5. Create new webhook connections.
6. Patch validation or rules gaps.
7. Document the incident and remediation.

## Release security review

Before production:

- Run dependency audits.
- Review Firestore rules with emulator tests.
- Confirm functions reject unsupported symbols.
- Confirm webhook IDs are random and non-enumerable.
- Confirm notification tokens are scoped to the owning user.
- Confirm app screenshots and logs do not leak webhook URLs.
- Confirm privacy policy and terms reflect actual behavior.

Security controls reduce operational risk but do not reduce market risk. Confidence remains a quality/completeness measure, not a win probability.
