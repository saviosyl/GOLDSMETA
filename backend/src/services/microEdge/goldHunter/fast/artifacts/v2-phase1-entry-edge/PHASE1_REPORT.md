# GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery

Research only. **No deploy. No threshold changes. No broker/shadow orders. No V2 trading logic.**

## Verdict

**INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION**

**No candidate rule shows positive prospective edge after friction** on discovery∩validation (n≥30 both).

All substantial continuous Spot+Depth streams are from a single London morning (2026-08-14). Chronological 50/25/25 splits within that morning are IN-SAMPLE RESEARCH only and must not be treated as true holdout across independent regimes.

- Clean candidates: **12027** (excluded contaminated: 11577 of 23604)
- Friction assumed: **0.06**
- Any positive prospective edge after friction: **False**

## 1. Dataset inventory

- GCS live-shadow run IDs: **28**
- Substantial usable (same UTC morning 2026-08-14 only):
  - gh_fast_mssjjspo_8ubuxa (22 chunks, ~06:03–07:25)
  - gh_fast_mssmh2w2_ftl4pq (3 chunks, ~07:28–07:38)
  - gh_fast_mssnh4uq_v488yc (32 chunks, ~07:53–10:06)
- Unit-test/tiny probes: Most other 10-chunk runs are unit-test uploads with rowCount=2 per chunk (configHash=default). Not usable for feature research.
- Contamination note: V1 fail run (~91 resyncs / DATA_STALE / BOOK_REBUILDING windows). Stormy early run also has frequent rebuild/stale. Contaminated windows excluded from clean set.
- See `DATASET_INVENTORY.json`.

## 2. Clean usable event periods

| Run | Start | End | Hours | Clean candidates |
|-----|-------|-----|------:|-----------------:|
| gh_fast_mssjjspo_8ubuxa | 2026-08-14T06:03:24.833Z | 2026-08-14T07:25:26.505Z | 1.3671 | 131 |
| gh_fast_mssmh2w2_ftl4pq | 2026-08-14T07:25:16.976Z | 2026-08-14T07:38:31.353Z | 0.2207 | 1007 |
| gh_fast_mssnh4uq_v488yc | 2026-08-14T07:53:19.191Z | 2026-08-14T10:06:23.277Z | 2.2178 | 10889 |

## 3. Excluded contaminated periods

- `gh_fast_mssjjspo_8ubuxa`: `{"book_rebuilding": 0, "data_stale": 10779, "feed_gap": 129, "crossed_book": 0, "resync_marker": 2, "insufficient_features": 322}`
- `gh_fast_mssmh2w2_ftl4pq`: `{"book_rebuilding": 80, "data_stale": 22, "feed_gap": 19, "crossed_book": 0, "resync_marker": 9, "insufficient_features": 67}`
- `gh_fast_mssnh4uq_v488yc`: `{"book_rebuilding": 877, "data_stale": 222, "feed_gap": 208, "crossed_book": 0, "resync_marker": 46, "insufficient_features": 632}`

Early stormy run `gh_fast_mssjjspo_8ubuxa` is almost entirely DATA_STALE/feed-gap contaminated (only 131 clean candidate rows).

## 4. Candidate event counts A/B/C (clean)

```json
{
  "bySetupClean": {
    "A": 5787,
    "B": 5530,
    "C": 710
  },
  "eligibleClean": {
    "A": 442,
    "B": 174,
    "C": 4
  },
  "selectedClean": {
    "A": 436,
    "B": 156,
    "C": 2
  }
}
```

## 5. Setup C — eligibility / selectability

- Raw eligible (clean candidate rows): **4**
- Sub-threshold (rawQuality present, not eligible): **0**
- Selected (clean): **2**
- Soft-near rows: **0**
- Per-tick structural census: featureTicks=27479, eligible=7, structuralFail=27472, selected=5
- Why structural fails: C requires impulse midVel3s + efficiency3s>0.35, pullback depth in (0.08, pullbackRetraceMax], then same-sign midVel250+acceleration+imbalance. Most feature ticks fail impulse/efficiency or pullback window — rawQuality stays null.
- Top fail reasons: `{"impulse_vel3s_too_weak": 25875, "efficiency3s_too_low": 8864, "pullback_too_shallow": 1368, "pullback_not_confirmed": 1525, "reaccel_acceleration_missing": 817, "reaccel_imbalance_missing": 480, "reaccel_vel250_missing": 410, "pullback_too_deep": 4}`
- Eligible-not-selected forward@3s: n=2, meanSigned=-0.3300, edgeAF=-0.3900, pFav@0.05=0

C has **no useful latent edge** in this sample: almost never structurally eligible; when eligible-not-selected (n=2) forward path is immediately adverse.

## 6. BUY vs SELL forward outcomes (eligible, clean)

| Side | n | meanSigned@3s | edge after friction | pFavFirst@0.05 | avg MFE | avg MAE |
|------|--:|--------------:|--------------------:|---------------:|--------:|--------:|
| BUY | 287 | -0.1581 | -0.2181 | 0.0730 | 0.0300 | -0.2478 |
| SELL | 333 | -0.1577 | -0.2177 | 0.1242 | 0.0593 | -0.2542 |

Both sides negative after friction. SELL has slightly higher pFavFirst but still deeply negative expectancy.

## 7. Forward movement tables (eligible only)

| Horizon | n | mean signed | edge after friction | pFav@0.05 | pFav@0.10 |
|--------:|--:|------------:|--------------------:|----------:|----------:|
| 1000ms | 620 | -0.1345 | -0.1945 | 0.0471 | 0.0460 |
| 2000ms | 620 | -0.1394 | -0.1994 | 0.0908 | 0.0881 |
| 3000ms | 620 | -0.1579 | -0.2179 | 0.1003 | 0.1189 |
| 5000ms | 620 | -0.1895 | -0.2495 | 0.0993 | 0.1363 |
| 10000ms | 620 | -0.1660 | -0.2260 | 0.0990 | 0.1419 |

Full A/B/C × horizon tables: `PHASE1_REPORT.json` → `forwardMovementTables`.

## 8. Strongest entry-time feature separators

On DISCOVERY eligible: strong continuation = +0.05 before −0.05 within 3s; immediate failure = opposite.
- strongContinuationN=36, immediateFailureN=296
- 2D velocity × spread (all bins still negative after friction):
```json
[
  {
    "vel": "weak",
    "spread": "tight",
    "n": 19,
    "pFavFirst_0_05": 0.2631578947368421,
    "meanSigned": -0.06894736842097796,
    "edgeAfterFriction": -0.12894736842097795
  },
  {
    "vel": "weak",
    "spread": "mid",
    "n": 34,
    "pFavFirst_0_05": 0,
    "meanSigned": -0.20117647058818608,
    "edgeAfterFriction": -0.26117647058818605
  },
  {
    "vel": "weak",
    "spread": "wide",
    "n": 0,
    "pFavFirst_0_05": null,
    "meanSigned": null,
    "edgeAfterFriction": null
  },
  {
    "vel": "mod",
    "spread": "tight",
    "n": 88,
    "pFavFirst_0_05": 0.1590909090909091,
    "meanSigned": -0.17772727272722477,
    "edgeAfterFriction": -0.23772727272722477
  },
  {
    "vel": "mod",
    "spread": "mid",
    "n": 150,
    "pFavFirst_0_05": 0.06716417910447761,
    "meanSigned": -0.14618055555551893,
    "edgeAfterFriction": -0.20618055555551892
  },
  {
    "vel": "mod",
    "spread": "wide",
    "n": 0,
    "pFavFirst_0_05": null,
    "meanSigned": null,
    "edgeAfterFriction": null
  },
  {
    "vel": "strong",
    "spread": "tight",
    "n": 26,
    "pFavFirst_0_05": 0.08333333333333333,
    "meanSigned": -0.1176923076922881,
    "edgeAfterFriction": -0.1776923076922881
  },
  {
    "vel": "strong",
    "spread": "mid",
    "n": 33,
    "pFavFirst_0_05": 0.18181818181818182,
    "meanSigned": -0.10666666666673502,
    "edgeAfterFriction": -0.16666666666673502
  },
  {
    "vel": "strong",
    "spread": "wide",
    "n": 0,
    "pFavFirst_0_05": null,
    "meanSigned": null,
    "edgeAfterFriction": null
  }
]
```
- No interpretable separator reverses the sign of mean executable move after friction.

## 9. Candidate interpretable entry rules

- `R3_vel_depth_agree`: side-aligned vel1s AND depthImbalance agrees with side
- `R4_accel_remove_liq`: accel aligned + opposite liquidity being removed
- `R7_quality_ge_065`: rawQuality>=0.65 (control — quality alone)
- `R8_imb_and_vel`: signedImbalance agrees with side AND abs(midVel250) strong

Rules locked from DISCOVERY ranking only (top-4 by after-friction 3s mean).

## 10. Discovery results

- R3_vel_depth_agree: n=3 meanSigned=-0.1300 edgeAF=-0.1900 pFav@0.05=0
- R4_accel_remove_liq: n=436 meanSigned=-0.0995 edgeAF=-0.1595 pFav@0.05=0.1535
- R7_quality_ge_065: n=118 meanSigned=-0.1314 edgeAF=-0.1914 pFav@0.05=0.0789
- R8_imb_and_vel: n=667 meanSigned=-0.1306 edgeAF=-0.1906 pFav@0.05=0.1342

## 11. Validation results (same morning — not independent)

- R3_vel_depth_agree: n=1 meanSigned=0.0900 edgeAF=0.0300 pFav@0.05=1
- R4_accel_remove_liq: n=252 meanSigned=-0.1079 edgeAF=-0.1679 pFav@0.05=0.1179
- R7_quality_ge_065: n=73 meanSigned=-0.1876 edgeAF=-0.2476 pFav@0.05=0.1765
- R8_imb_and_vel: n=303 meanSigned=-0.1492 edgeAF=-0.2092 pFav@0.05=0.1712

## 12. True untouched holdout

**null** — `INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION`

Pseudo same-morning holdout reported only for transparency in JSON (`holdoutResults.pseudoSameMorningHoldout`).

## 13. Evidence after friction

```json
{
  "anyPositiveProspectiveEdgeAfterFriction": false,
  "note": "Requires n>=30 on discovery AND validation with after-friction meanSigned@3s > 0 for the SAME locked rule. Pseudo-holdout never used for claim.",
  "details": [
    {
      "id": "R3_vel_depth_agree",
      "discoveryEdge": -0.19000000000010914,
      "validationEdge": 0.03000000000014552,
      "discoveryN": 3,
      "validationN": 1,
      "bothPositive": false
    },
    {
      "id": "R4_accel_remove_liq",
      "discoveryEdge": -0.15953995157381384,
      "validationEdge": -0.16792682926835997,
      "discoveryN": 436,
      "validationN": 252,
      "bothPositive": false
    },
    {
      "id": "R7_quality_ge_065",
      "discoveryEdge": -0.19137931034479433,
      "validationEdge": -0.24764705882354598,
      "discoveryN": 118,
      "validationN": 73,
      "bothPositive": false
    },
    {
      "id": "R8_imb_and_vel",
      "discoveryEdge": -0.19059970014990954,
      "validationEdge": -0.20922558922562193,
      "discoveryN": 667,
      "validationN": 303,
      "bothPositive": false
    }
  ]
}
```

## 14. Any rule with positive prospective edge?

**False**

## 15. Overfitting warnings

- Only one independent London morning with substantial Level-II coverage.
- Chronological splits within that morning share microstructure regime, news window, and liquidity.
- Do not combine Phase 0 loss-reduction rules with Phase 1 discovery rules on the same sample.
- Soft near-miss expansion increases sample size but is not the live entry gate.
- INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION — stop; do not pretend one morning split is strong OOS.

## 16. More data required?

**YES.** Do not deploy V2. Do not retune thresholds from this morning.

## 17. Data-capture-only design (NOT deployed)

```json
{
  "purpose": "Collect independent clean Spot+Depth periods for genuine OOS entry-edge research",
  "scope": "SCOPE_VIEW only",
  "brokerOrders": 0,
  "shadowOrders": 0,
  "mutationSurface": "NONE",
  "capture": [
    "Spot + Depth events with receiveSeq",
    "raw transport/onSpot/onDepth callback timestamps (pre-queue)",
    "subscription flags (spotSubscribed/depthSubscribed)",
    "event-loop lag / heartbeat",
    "ordered queue depth + enqueue\u2192process latency",
    "reconnect/resync lifecycle with classified reasons",
    "per-event raw A/B/C specialist telemetry (eligible/rawQuality/failedConditions/selected)",
    "book generation / crossed / warmingUp"
  ],
  "deployNow": false,
  "note": "Design only \u2014 DO NOT deploy as part of Phase 1"
}
```

## 18. Exact files / artifacts created

- `backend/scripts/microEdge/goldHunterFastPhase1EntryEdgeCli.ts`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.json`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.md`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/DATASET_INVENTORY.json`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/candidates_clean_sample.jsonl`
