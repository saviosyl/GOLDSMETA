# GOLD_HUNTER FAST V2 — Phase 0 Report (Review Corrections)

PR #119 frozen. PR #121 DRAFT. No deploy. No broker orders.

## Corrected quantity definitions
- **engineMFE**: Live engine: openTrade.mfe initializes at 0; updateOpenTrade does mfe = Math.max(mfe, unrealizedSignedExecutable). Therefore engine MFE is always >= 0. MFE < 0 and MFE < -0.05 are impossible in the real engine.
- **engineMAE**: Live engine: mae initializes at 0; mae = Math.min(mae, unrealizedSignedExecutable). MAE tracks the most adverse signed executable move (typically <= 0).
- **signedExecutableMove**: At time t for an open trade: BUY => bid_t - entryPrice; SELL => entryPrice - ask_t. This is current mark-to-market vs entry (can be negative immediately due to spread).
- **priorOfflineBug**: The withdrawn rule `mfe<-0.05 AND alignedVel<=0 by 3000ms` did NOT use engine MFE. Offline path used max(signedExecutableMove over horizon) but incorrectly treated that series as if negative values were valid "MFE". In practice the offline variable was max_t signedExecutableMove(t) over [0, horizon], which is often still negative in the first seconds because of spread — i.e. peak signed P/L so far, NOT engine MFE (which would clamp that peak via Math.max with 0). Renaming alone is insufficient; CFs below use explicitly named live-implementable quantities.

## Corrected early-failure table (3s, continuous path)
- `A: engineMFE < +0.05 AND alignedVel <= 0 at 3s` affected=76 W/L=14/62 winDest=0.219 netΔ=10.07 net=-26.38 PF=0.422 exp=-0.150 DD=28.88
- `B: signedExecutableMove < -0.05 AND alignedVel <= 0 at 3s` affected=70 W/L=10/60 winDest=0.156 netΔ=10.37 net=-26.08 PF=0.428 exp=-0.148 DD=28.46
- `C: signedExecutableMove < -0.10 AND alignedVel < 0 at 3s` affected=60 W/L=7/53 winDest=0.109 netΔ=8.74 net=-27.71 PF=0.420 exp=-0.157 DD=30.09
- `D: signedExecutableMove < -0.15 AND alignedVel < 0 at 3s` affected=53 W/L=6/47 winDest=0.094 netΔ=7.63 net=-28.82 PF=0.412 exp=-0.164 DD=31.20

## Feed-gap root cause
- Defensible finding: Observed market-data input silence of ~27s median immediately before stale watchdog reconnects (seq advances by 1 across the wall-clock gap).
- ROOT_CAUSE_LAYER = **UNRESOLVED**
- Persisted V1 chunks contain only post-bridge collector records (event receiveSeq, decision, status). They do not include raw transport/callback timestamps, WS disconnect frames, subscription flag changes, bridge queue wait during the silent interval, or event-loop stall probes. Therefore upstream cTrader silence vs transport disconnect vs subscription loss vs process stall cannot be proven from this dataset.

## Strategy conclusion
Phase 0 has NOT demonstrated a profitable V2 rule set. Individual counterfactuals remain negative expectancy / PF<1 (spread<=0.10 PF~0.62; corrected 3s aborts still PF<<1; re-entry cooldown PF still far below 1). Need genuine entry-edge improvement, not merely reduced losses. Do not combine many same-sample rules and call that validation. Any combination tests are IN-SAMPLE RESEARCH only; reserve independent periods for OOS.

## V1 vs Phase0 behavioural equivalence
- match=True digest=`d1af407eff9ebaa8703972035c85a8cfee286303532030b73560ed6b7d882341` n=59
