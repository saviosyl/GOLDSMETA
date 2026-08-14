# GOLD_HUNTER FAST V2 — Phase 0 Report

Research only. PR #119 frozen. No deploy. No broker orders.

## 1. Root cause of 91 resyncs
Periodic Spotware/transport feed stalls (~27s median silence) tripped the 20s stale-feed watchdog. Reconnect+reset ran on an ~87s cadence (75–90s dominant). Invalid/crossed-book reasons were 0 in the decision stream; ~32 open trades were force-closed without collector EXIT rows. Instrumentation labeled all resets transport_reconnect, hiding stale vs invalid classification.

- Observed BOOK_REBUILDING onsets in chunks: 85 (health resyncCount=91)
- Trigger class counts: `{'feed_gap_stale_reconnect': 46, 'stale_spot_and_depth': 1, 'during_open_hold_feed_gap': 31, 'stale_spot': 5, 'stale_depth': 2}`
- Crossed-book decision reasons: 0
- Feed gap at resync p50: 27301 ms (all >20s)
- Inter-resync p50: 86.6s
- Enters followed by rebuild before EXIT: 32

## 2–4. Integrity fix + tests
See PHASE0_REPORT.json sections 2–4. Tests in `goldHunterFastPhase0Integrity.test.ts`.

## 5–6. Specialist / why C=0
C=0 selected does NOT prove C never met raw conditions. Stream shows pullback_not_confirmed=109 (impulse present but pullback/reaccel gates failed) and near_A only 4 times; no near_C rows because soft quality path rarely produced a C hit even with minSetupQuality lowered in diagnostics. Likely: C impulse+efficiency+pullback+reaccel conjunction is rare in this London sample; when present, A/B may still win best-of. Phase 0B instrumentation now records raw eligible/quality/failedConditions for A,B,C on every candidate evaluation.

## 7. Entry separation
- **wins**: n=64 W/L=64/0 WR=1.000 net=21.05 PF=inf exp=0.329 DD=0.00
- **dead_mfe_lt_0.05**: n=85 W/L=0/85 WR=0.000 net=-45.89 PF=0.000 exp=-0.540 DD=45.89
- **immediate_adverse**: n=76 W/L=0/76 WR=0.000 net=-44.76 PF=0.000 exp=-0.589 DD=44.76
- **hard_protection**: n=52 W/L=4/48 WR=0.077 net=-27.16 PF=0.160 exp=-0.522 DD=27.16
- **harvest_fade**: n=29 W/L=26/3 WR=0.897 net=3.25 PF=1.956 exp=0.112 DD=1.73

Entry filter counterfactuals (exits unchanged):
- `entrySpread<=0.10`: removed 108 (W35/L73), netΔ=29.12, kept n=68 W/L=29/39 WR=0.426 net=-7.33 PF=0.620 exp=-0.108 DD=8.60
- `entrySpread<=0.11`: removed 70 (W20/L50), netΔ=22.56, kept n=106 W/L=44/62 WR=0.415 net=-13.89 PF=0.542 exp=-0.131 DD=16.42
- `abs(entryVel)>=5e-5`: removed 29 (W9/L20), netΔ=2.93, kept n=147 W/L=55/92 WR=0.374 net=-33.52 PF=0.281 exp=-0.228 DD=35.12
- `abs(entryVel)>=8e-5`: removed 51 (W17/L34), netΔ=8.12, kept n=125 W/L=47/78 WR=0.376 net=-28.33 PF=0.280 exp=-0.227 DD=29.41
- `abs(entryAccel)>=3e-5`: removed 32 (W9/L23), netΔ=7.50, kept n=144 W/L=55/89 WR=0.382 net=-28.95 PF=0.361 exp=-0.201 DD=30.55
- `setupQuality>=0.65 (control — expect weak)`: removed 107 (W40/L67), netΔ=19.02, kept n=69 W/L=24/45 WR=0.348 net=-17.43 PF=0.198 exp=-0.253 DD=17.84
- `setupQuality>=0.70 (control — expect weak)`: removed 138 (W47/L91), netΔ=28.42, kept n=38 W/L=17/21 WR=0.447 net=-8.03 PF=0.275 exp=-0.211 DD=8.03
- `spread<=0.10 AND absVel>=5e-5`: removed 120 (W41/L79), netΔ=23.62, kept n=56 W/L=23/33 WR=0.411 net=-12.83 PF=0.263 exp=-0.229 DD=13.05
- `setup B only`: removed 111 (W41/L70), netΔ=25.84, kept n=65 W/L=23/42 WR=0.354 net=-10.61 PF=0.522 exp=-0.163 DD=11.98
- `setup A only`: removed 65 (W23/L42), netΔ=10.61, kept n=111 W/L=41/70 WR=0.369 net=-25.84 PF=0.268 exp=-0.233 DD=26.70

## 8. Re-entry counterfactuals
- cd=1000ms after=any: rem 0 (W0/L0) netΔ=0.00 | kept n=176 W/L=64/112 WR=0.364 net=-36.45 PF=0.366 exp=-0.207 DD=38.05
- cd=2000ms after=any: rem 4 (W4/L0) netΔ=-0.99 | kept n=172 W/L=60/112 WR=0.349 net=-37.44 PF=0.349 exp=-0.218 DD=38.87
- cd=3000ms after=any: rem 9 (W5/L4) netΔ=1.26 | kept n=167 W/L=59/108 WR=0.353 net=-35.19 PF=0.363 exp=-0.211 DD=37.15
- cd=5000ms after=any: rem 15 (W7/L8) netΔ=3.63 | kept n=161 W/L=57/104 WR=0.354 net=-32.82 PF=0.376 exp=-0.204 DD=34.78
- cd=10000ms after=any: rem 22 (W7/L15) netΔ=6.58 | kept n=154 W/L=57/97 WR=0.370 net=-29.87 PF=0.403 exp=-0.194 DD=31.83
- cd=5000ms after=['HARD_PROTECTION']: rem 5 (W2/L3) netΔ=1.20 | kept n=171 W/L=62/109 WR=0.363 net=-35.25 PF=0.368 exp=-0.206 DD=36.68
- cd=5000ms after=['RAPID_ABORT']: rem 1 (W1/L0) netΔ=-0.20 | kept n=175 W/L=63/112 WR=0.360 net=-36.65 PF=0.363 exp=-0.209 DD=38.25
- cd=5000ms after=['HARD_PROTECTION', 'RAPID_ABORT']: rem 6 (W3/L3) netΔ=1.00 | kept n=170 W/L=61/109 WR=0.359 net=-35.45 PF=0.365 exp=-0.209 DD=36.88
- cd=10000ms after=['HARD_PROTECTION', 'RAPID_ABORT']: rem 7 (W3/L4) netΔ=1.13 | kept n=169 W/L=61/108 WR=0.361 net=-35.32 PF=0.366 exp=-0.209 DD=36.75

## 9. Early-failure counterfactuals
First 250–500ms is dominated by spread crossing (almost all trades underwater); raw noFavourableMove is not discriminative that early. Separation emerges by 2–3s: winners recover MFE / keep side-aligned velocity; dead/HARD_PROTECTION deepen adverse signed move and lose aligned velocity. Best viable CF (win destruction ≤25%): `alignedVel<0 by 3000ms => abort` netΔ=9.91 abortOrig W/L=16/62 => PF=0.420 exp=-0.151. RESEARCH_ONLY — needs multi-period validation.

First 250–500ms is dominated by spread crossing (almost all trades underwater); raw noFavourableMove is not discriminative that early. Separation emerges by 2–3s: winners recover MFE / keep side-aligned velocity; dead/HARD_PROTECTION deepen adverse signed move and lose aligned velocity.

Live abort CFs (continuous path only):
- `alignedVel<0 by 3000ms => abort` netΔ=9.91 abortW/L=16/62 winDest=0.25 => WR=0.290 net=-26.54 PF=0.420 exp=-0.151
- `mfe<-0.05 AND alignedVel<=0 by 3000ms => abort` netΔ=9.39 abortW/L=7/51 winDest=0.11 => WR=0.324 net=-27.06 PF=0.425 exp=-0.154
- `mfe<0 AND alignedVel<0 by 3000ms => abort` netΔ=9.38 abortW/L=10/52 winDest=0.16 => WR=0.307 net=-27.07 PF=0.419 exp=-0.154
- `signed<-0.15 AND alignedVel<0 by 3000ms => abort` netΔ=7.63 abortW/L=6/47 winDest=0.09 => WR=0.330 net=-28.82 PF=0.412 exp=-0.164
- `signedMove<-0.20 by 3000ms => abort` netΔ=6.63 abortW/L=8/52 winDest=0.12 => WR=0.318 net=-29.82 PF=0.388 exp=-0.169
- `signedMove<-0.20 by 2000ms => abort` netΔ=4.58 abortW/L=11/43 winDest=0.17 => WR=0.301 net=-31.87 PF=0.362 exp=-0.181
- `mfe<0 AND alignedVel<0 by 2000ms => abort` netΔ=2.44 abortW/L=20/56 winDest=0.31 => WR=0.250 net=-34.01 PF=0.269 exp=-0.193
- `alignedVel<0 by 2000ms => abort` netΔ=2.29 abortW/L=25/60 winDest=0.39 => WR=0.239 net=-34.16 PF=0.252 exp=-0.194
- `mfe<-0.05 AND alignedVel<=0 by 2000ms => abort` netΔ=0.83 abortW/L=21/55 winDest=0.33 => WR=0.244 net=-35.62 PF=0.257 exp=-0.202
- `signedMove<-0.20 by 1000ms => abort` netΔ=-0.87 abortW/L=9/26 winDest=0.14 => WR=0.312 net=-37.32 PF=0.332 exp=-0.212
## 10–12. Proposed rules / exits / files
{
  "doNotSimplyRaiseMinSetupQuality": true,
  "candidates": [
    {
      "id": "E1_early_pressure_3s",
      "rule": "At ~3s after entry: if MFE still <-0.05 and side-aligned velocity \u22640, flatten. (Alternative: signedMove<-0.15 AND alignedVel<0.) Not a 250\u2013500ms MFE gate.",
      "evidence": "mfe<-0.05 AND alignedVel<=0 by 3000ms => abort",
      "status": "RESEARCH_ONLY",
      "counterfactual": {
        "rule": "mfe<-0.05 AND alignedVel<=0 by 3000ms => abort",
        "horizonMs": 3000,
        "skippedFeedGap": 2,
        "abortedOriginalWins": 7,
        "abortedOriginalLosses": 51,
        "netMoveChange": 9.390000000001237,
        "simulated": {
          "n": 176,
          "wins": 57,
          "losses": 119,
          "winRate": 0.32386363636363635,
          "netMove": -27.059999999997274,
          "PF": 0.4253557018475595,
          "expectancy": -0.1537499999999845,
          "maxDD": 29.439999999998555
        },
        "winDestructionRate": 0.109375
      }
    },
    {
      "id": "E2_spread_cap_tight",
      "rule": "Skip arm when spread > 0.10 (research band; freeze current maxSpread in prod until multi-period confirm).",
      "evidence": "entry filter spread<=0.10",
      "status": "RESEARCH_ONLY"
    },
    {
      "id": "E3_reentry_after_hard_5s",
      "rule": "Suppress same side+setup re-entry for 5s after HARD_PROTECTION or RAPID_ABORT.",
      "evidence": "re-entry CF table",
      "status": "RESEARCH_ONLY"
    },
    {
      "id": "E4_keep_harvest_exits",
      "rule": "Do not broaden exit changes; HARVEST_FADE net positive in V1.",
      "evidence": "byExit HARVEST_FADE",
      "status": "PRESERVE"
    }
  ],
  "sessionFilter": "Do NOT hard-code Dublin/London hour filters from this single morning sample."
}

{
  "deferUntilEntryFiltersValidated": true,
  "experiments": [
    "Confirm whether E1 early-confirm reduces HARD_PROTECTION without killing HARVEST winners.",
    "Only then consider trail/activation tweaks; TRAIL_HIT was mixed, HARVEST_FADE positive.",
    "DATA_STALE exits should become rare once resync integrity + feed stall root cause addressed."
  ]
}

Files:
- `backend/src/services/microEdge/goldHunter/fast/types.ts`
- `backend/src/services/microEdge/goldHunter/fast/setups.ts`
- `backend/src/services/microEdge/goldHunter/fast/engine.ts`
- `backend/src/services/microEdge/goldHunter/fast/collector.ts`
- `backend/src/services/microEdge/goldHunter/fast/liveBridge.ts`
- `backend/src/services/microEdge/goldHunter/fast/replay.ts`
- `backend/src/services/microEdge/goldHunter/fast/replayVerify.ts`
- `backend/src/services/microEdge/runtime/fastShadowRuntime.ts`
- `backend/tests/unit/microEdge/goldHunter/goldHunterFastPhase0Integrity.test.ts`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase0-research/PHASE0_REPORT.json`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase0-research/PHASE0_REPORT.md`
