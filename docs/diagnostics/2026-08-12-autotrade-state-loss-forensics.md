# AutoTrade state-loss forensics — 2026-08-12

**READ-ONLY evidence capture. No production writes performed during Phase 1–4.**

Production tip inspected: `6459ee73d23bee51cc18bc865895795077010162`  
Firebase project: `goldmeta-web`

## Root cause (proven)

Production did **not** wipe the owner Demo Auto / qualification state.

| Identity | UID (masked) | Email (masked) | Demo account | Qualification | Intent | Today 80+ rejects |
|---|---|---|---|---|---|---|
| Pinned OWNER | `IwlS…w4C2` | `sa…@gmail.com` | `48…10` (`…4710`) | **LIVE_QUALIFICATION** (started 2026-08-08) | **true** | QUOTE_AGE / MARGIN / armed — **not** NOT_STARTED |
| Secondary USER | `8D1P…BGp1` | `va…@gmail.com` | **same** `48…10` | **none** (`READY_TO_QUALIFY`, startedAt=null) | **false** | **11× QUALIFICATION_NOT_STARTED** |

The UI symptoms reported (NOT STARTED, Demo Auto OFF, INTENT OFF, 0/20, 11 rejected with “qualification was not started”) match the **secondary Firebase login** exactly via `getQualificationView` + evaluation logs.

Owner Firestore still shows:

- `users/{owner}/autotradeQualification/{…4710}.state = LIVE_QUALIFICATION`
- `demoAutoEnabledAt` set
- `autotradeSettings/demo.autoTradeEnabledIntent = true`
- `paused = false`, `emergencyStopActive = false`
- `demoProfitLockLadderEnabled = true`
- meta pointer `autotradeQualificationMeta/current.accountId = …4710`

## Why post-#110 reported LIVE_QUALIFICATION

Those checks used the pinned owner UID (`GOLDMETA_PINNED_OWNER_UID` / `sa…@gmail.com`). That state is still present.

## Why production UI said NOT STARTED

The session showing 11 rejects / 0/20 was the secondary UID that also selected Pepperstone Demo `48…10` but never started qualification and has intent OFF.

## Quote SSOT finding

Secondary stored quote showed persisted `freshness: "LIVE"` while `brokerTimestamp` age was ~3–4 minutes. AutoTrade authority correctly computed `quoteHealthy=false` from age. Display vs execution diverged when consumers trusted the persisted freshness label. Fix: recompute freshness at read time in `getStoredAuthoritativeQuote`.

## Recovery decision (Phase 8)

- **Owner:** no Firestore repair required — state already `LIVE_QUALIFICATION` + intent ON.
- **Secondary:** do **not** auto-enable Demo Auto or fabricate qualification progress.
- **Manual owner action:** sign in as the owner login that owns the qualification, **or** disconnect the secondary login from Demo `48…10`.

## Code fixes in this PR

1. Detect foreign started qualification for the same Demo account → **QUALIFICATION ACCOUNT MISMATCH** (no silent 0/20).
2. `getQualificationView` is read-only (no create/save on GET).
3. Normalize cTrader account ids to string keys.
4. Quote read-time freshness SSOT.
5. UI: hide Pause when AutoTrade OFF; clearer Shadow / Live-lock copy; health card distinguishes intent vs not-started vs mismatch.
