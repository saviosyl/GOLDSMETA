# Privacy Policy Placeholder

This is a practical placeholder for drafting a real GoldMeta privacy policy. Have qualified counsel review the final policy before public release.

> GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision.

## Product summary

GoldMeta provides XAUUSD market analysis and decision support. It receives TradingView alerts, creates analysis decisions, sends optional push notifications, and may store user journal entries.

## Data collected

GoldMeta may collect:

- Account identifiers from Firebase Authentication.
- Device identifiers needed for push notifications.
- FCM push tokens.
- TradingView webhook payloads sent to your webhook URL.
- Market snapshots derived from webhook payloads.
- Generated decisions and analysis history.
- User settings.
- Journal entries you create.
- App diagnostics, crash reports, and backend logs.

GoldMeta should not collect broker login credentials or TradingView passwords.

## How data is used

Data is used to:

- Authenticate your account.
- Receive and validate market alerts.
- Generate and display decisions.
- Send push notifications.
- Maintain history and journal features.
- Improve reliability and troubleshoot errors.
- Enforce security, deduplication, and abuse prevention.

## AI processing

If AI explanations are enabled, validated market snapshot and decision context may be sent to an AI provider from the backend. Do not send API keys from the iOS app. Do not send unnecessary personal journal content for routine decision explanations.

AI is used for explanation and conflict review, not to guarantee outcomes.

## Data sharing

GoldMeta may share data with service providers needed to operate the app, such as:

- Firebase/Google Cloud for authentication, storage, functions, and notifications.
- Apple services for app distribution and iOS push infrastructure.
- AI provider for optional explanation features.

GoldMeta should not sell user trading data.

## Data retention

Suggested retention language:

- Decisions and journal entries remain until you delete them or close your account.
- Raw webhook events may be retained for audit, debugging, and abuse prevention for a limited period.
- Logs are retained according to operational settings and should avoid secrets.

Define exact retention periods before release.

## User controls

Users should be able to:

- Access their analysis history.
- Delete journal entries.
- Disable push notifications.
- Request data export, if supported.
- Request account deletion and associated data deletion.

## Security

GoldMeta should use:

- Firebase Authentication.
- Firestore security rules.
- HTTPS webhooks.
- Opaque webhook IDs.
- Secret Manager for backend secrets.
- Limited logging of sensitive values.

No security system is perfect.

## Children's privacy

GoldMeta is not intended for children. Define the minimum age for your jurisdiction before release.

## International users

If GoldMeta is available internationally, review requirements for GDPR, UK GDPR, CCPA/CPRA, and other applicable privacy laws.

## Contact

Replace this section with a real support email, business name, and mailing address before publication.

## Trading risk and confidence

GoldMeta confidence is a quality and completeness indicator. It is not a win probability and does not guarantee a profitable result.
