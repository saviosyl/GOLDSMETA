# GOLD_HUNTER FAST V2 — Phase 1 Entry Edge Discovery (CORRECTED)

Research only. **No deploy. No threshold changes. No broker/shadow orders. No V2 trading logic.**

## Corrections applied

- Forward label clock starts at candidate.t (not last SPOT quote t)
- Per-horizon CONTAMINATED_FUTURE_WINDOW when contamination hits (candidate.t, candidate.t+horizon]
- Unique market-event counts (runId+receiveSeq); cross-setup rules deduped by event+side

## Verdict (re-derived)

**INSUFFICIENT INDEPENDENT DATA FOR OOS VALIDATION**

**NO POSITIVE PROSPECTIVE ENTRY EDGE FOUND**

Phase 1 top-level conclusion **unchanged** vs prior pass after corrections (labels/numbers updated; verdict same).

All substantial continuous Spot+Depth streams are from a single London morning (2026-08-14). Chronological 50/25/25 splits within that morning are IN-SAMPLE RESEARCH only and must not be treated as true holdout across independent regimes.

- Clean candidate rows: **12027** (unique events: **8405**)
- Contaminated entry snapshots excluded: 11577 of 23604
- Friction assumed: **0.06**
- Any positive prospective edge after friction: **false**

## Label clock correction impact

```json
{
  "materialMoveEps": 0.01,
  "labelPairsCompared": 84189,
  "materialSignedMoveChanges": 4892,
  "samplePresenceChanges": 2493,
  "newlyEmptyUnderCorrectClock": 0,
  "newlyNonEmptyUnderCorrectClock": 2493,
  "byHorizon": {
    "250ms": {
      "compared": 12027,
      "material": 0
    },
    "500ms": {
      "compared": 12027,
      "material": 1945
    },
    "1000ms": {
      "compared": 12027,
      "material": 1605
    },
    "2000ms": {
      "compared": 12027,
      "material": 793
    },
    "3000ms": {
      "compared": 12027,
      "material": 362
    },
    "5000ms": {
      "compared": 12027,
      "material": 130
    },
    "10000ms": {
      "compared": 12027,
      "material": 57
    }
  }
}
```

## Clean forward label availability

```json
{
  "cleanCandidateSnapshots": 12027,
  "uniqueCleanCandidateEvents": 8405,
  "clean1sLabels": 9271,
  "uniqueClean1sLabelEvents": 6397,
  "clean2sLabels": 10857,
  "uniqueClean2sLabelEvents": 7559,
  "clean3sLabels": 10250,
  "uniqueClean3sLabelEvents": 7142,
  "clean5sLabels": 9164,
  "uniqueClean5sLabelEvents": 6386,
  "clean10sLabels": 6752,
  "uniqueClean10sLabelEvents": 4693
}
```

## Sample counts (rows vs unique events)

```json
{
  "candidatesBeforeExclusion": 23604,
  "uniqueEventsBeforeExclusion": 16368,
  "contaminatedExcluded": 11577,
  "cleanCandidates": 12027,
  "uniqueCleanEvents": 8405,
  "bySetupClean": {
    "A": {
      "rows": 5787,
      "uniqueEvents": 5787
    },
    "B": {
      "rows": 5530,
      "uniqueEvents": 5530
    },
    "C": {
      "rows": 710,
      "uniqueEvents": 710
    }
  },
  "eligibleClean": {
    "A": {
      "rows": 442,
      "uniqueEvents": 442
    },
    "B": {
      "rows": 174,
      "uniqueEvents": 174
    },
    "C": {
      "rows": 4,
      "uniqueEvents": 4
    }
  },
  "selectedClean": {
    "A": 436,
    "B": 156,
    "C": 2
  }
}
```

## Setup C

```json
{
  "candidateRowCount": 710,
  "uniqueCandidateEventCount": 710,
  "rawEligibilityCount": 4,
  "uniqueEligibleEventCount": 4,
  "subThresholdCount": 0,
  "softNearCount": 0,
  "selectedCount": 2,
  "failedConditionCounts": {
    "pullback_too_shallow": 642,
    "pullback_not_confirmed": 706,
    "reaccel_acceleration_missing": 369,
    "reaccel_imbalance_missing": 218,
    "reaccel_vel250_missing": 197
  },
  "eligibleNotSelected": {
    "n": 2,
    "forward3s": {
      "candidateRowCount": 2,
      "uniqueCandidateEventCount": 2,
      "nAfterDedupe": 2,
      "labeledClean": 2,
      "buy": 0,
      "sell": 2,
      "pFavFirst_0_05": 0,
      "pFavFirst_0_10": 0,
      "pFavFirst_0_15": 0,
      "pFavFirst_0_20": 0,
      "avgForwardMfe": 0,
      "avgForwardMae": -0.32999999999992724,
      "medianForwardMfe": 0,
      "medianForwardMae": -0.32999999999992724,
      "meanSigned": -0.32999999999992724,
      "estimatedGrossEdge": -0.32999999999992724,
      "estimatedEdgeAfterFriction": -0.38999999999992724,
      "signedQuantiles": {
        "0.1": -0.32999999999992724,
        "0.25": -0.32999999999992724,
        "0.5": -0.32999999999992724,
        "0.75": -0.32999999999992724,
        "0.9": -0.32999999999992724
      },
      "mfeQuantiles": {
        "0.1": 0,
        "0.25": 0,
        "0.5": 0,
        "0.75": 0,
        "0.9": 0
      },
      "maeQuantiles": {
        "0.1": -0.32999999999992724,
        "0.25": -0.32999999999992724,
        "0.5": -0.32999999999992724,
        "0.75": -0.32999999999992724,
        "0.9": -0.32999999999992724
      }
    },
    "forward5s": {
      "candidateRowCount": 2,
      "uniqueCandidateEventCount": 2,
      "nAfterDedupe": 2,
      "labeledClean": 2,
      "buy": 0,
      "sell": 2,
      "pFavFirst_0_05": 0,
      "pFavFirst_0_10": 0,
      "pFavFirst_0_15": 0,
      "pFavFirst_0_20": 0,
      "avgForwardMfe": 0,
      "avgForwardMae": -0.7800000000006548,
      "medianForwardMfe": 0,
      "medianForwardMae": -0.7800000000006548,
      "meanSigned": -0.47000000000025466,
      "estimatedGrossEdge": -0.47000000000025466,
      "estimatedEdgeAfterFriction": -0.5300000000002547,
      "signedQuantiles": {
        "0.1": -0.47000000000025466,
        "0.25": -0.47000000000025466,
        "0.5": -0.47000000000025466,
        "0.75": -0.47000000000025466,
        "0.9": -0.47000000000025466
      },
      "mfeQuantiles": {
        "0.1": 0,
        "0.25": 0,
        "0.5": 0,
        "0.75": 0,
        "0.9": 0
      },
      "maeQuantiles": {
        "0.1": -0.7800000000006548,
        "0.25": -0.7800000000006548,
        "0.5": -0.7800000000006548,
        "0.75": -0.7800000000006548,
        "0.9": -0.7800000000006548
      }
    }
  },
  "eligibleForward3s": {
    "candidateRowCount": 4,
    "uniqueCandidateEventCount": 4,
    "nAfterDedupe": 4,
    "labeledClean": 4,
    "buy": 2,
    "sell": 2,
    "pFavFirst_0_05": 0,
    "pFavFirst_0_10": 0,
    "pFavFirst_0_15": 0,
    "pFavFirst_0_20": 0,
    "avgForwardMfe": 0,
    "avgForwardMae": -0.24000000000023647,
    "medianForwardMfe": 0,
    "medianForwardMae": -0.24000000000023647,
    "meanSigned": -0.24000000000023647,
    "estimatedGrossEdge": -0.24000000000023647,
    "estimatedEdgeAfterFriction": -0.30000000000023647,
    "signedQuantiles": {
      "0.1": -0.32999999999992724,
      "0.25": -0.32999999999992724,
      "0.5": -0.24000000000023647,
      "0.75": -0.1500000000005457,
      "0.9": -0.1500000000005457
    },
    "mfeQuantiles": {
      "0.1": 0,
      "0.25": 0,
      "0.5": 0,
      "0.75": 0,
      "0.9": 0
    },
    "maeQuantiles": {
      "0.1": -0.32999999999992724,
      "0.25": -0.32999999999992724,
      "0.5": -0.24000000000023647,
      "0.75": -0.1500000000005457,
      "0.9": -0.1500000000005457
    }
  },
  "selectedForward3s": {
    "candidateRowCount": 2,
    "uniqueCandidateEventCount": 2,
    "nAfterDedupe": 2,
    "labeledClean": 2,
    "buy": 2,
    "sell": 0,
    "pFavFirst_0_05": 0,
    "pFavFirst_0_10": 0,
    "pFavFirst_0_15": 0,
    "pFavFirst_0_20": null,
    "avgForwardMfe": 0,
    "avgForwardMae": -0.1500000000005457,
    "medianForwardMfe": 0,
    "medianForwardMae": -0.1500000000005457,
    "meanSigned": -0.1500000000005457,
    "estimatedGrossEdge": -0.1500000000005457,
    "estimatedEdgeAfterFriction": -0.2100000000005457,
    "signedQuantiles": {
      "0.1": -0.15000000000054572,
      "0.25": -0.1500000000005457,
      "0.5": -0.1500000000005457,
      "0.75": -0.1500000000005457,
      "0.9": -0.1500000000005457
    },
    "mfeQuantiles": {
      "0.1": 0,
      "0.25": 0,
      "0.5": 0,
      "0.75": 0,
      "0.9": 0
    },
    "maeQuantiles": {
      "0.1": -0.15000000000054572,
      "0.25": -0.1500000000005457,
      "0.5": -0.1500000000005457,
      "0.75": -0.1500000000005457,
      "0.9": -0.1500000000005457
    }
  },
  "perTickStructuralCensus": {
    "featureTicks": 27479,
    "eligible": 7,
    "subThreshold": 0,
    "structuralFail": 27472,
    "selected": 5,
    "failedConditionCounts": {
      "impulse_vel3s_too_weak": 25875,
      "efficiency3s_too_low": 8864,
      "pullback_too_shallow": 1368,
      "pullback_not_confirmed": 1525,
      "reaccel_acceleration_missing": 817,
      "reaccel_imbalance_missing": 480,
      "reaccel_vel250_missing": 410,
      "pullback_too_deep": 4
    }
  },
  "whyStructuralFails": "C requires impulse midVel3s + efficiency3s>0.35, pullback depth in (0.08, pullbackRetraceMax], then same-sign midVel250+acceleration+imbalance. Most feature ticks fail impulse/efficiency or pullback window — rawQuality stays null."
}
```

## BUY vs SELL (eligible, CLEAN forward labels @3s)

| Side | rows | uniqueEvents | labeledClean | meanSigned | edgeAF | pFav@0.05 |
|------|-----:|-------------:|-------------:|-----------:|-------:|----------:|
| BUY | 287 | 280 | 259 | -0.1512 | -0.2112 | 0.0711 |
| SELL | 333 | 314 | 295 | -0.1654 | -0.2254 | 0.1271 |

## Forward tables (eligible, unique event+side dedupe)

| Horizon | labeledClean | meanSigned | edgeAF | pFav@0.05 |
|--------:|-------------:|-----------:|-------:|----------:|
| 1000ms | 490 | -0.1345 | -0.1945 | 0.0503 |
| 2000ms | 552 | -0.1391 | -0.1991 | 0.0951 |
| 3000ms | 528 | -0.1574 | -0.2174 | 0.1019 |
| 5000ms | 480 | -0.1829 | -0.2429 | 0.1008 |
| 10000ms | 369 | -0.1655 | -0.2255 | 0.0786 |

## Entry rules (discovery top / locked) — both tables

### R3_vel_depth_agree (generic)
- specialistRows: labeledClean=3 edgeAF=-0.1900
- uniqueMarketEventSide: labeledClean=1 edgeAF=-0.1900 uniqueEvents=1
### R4_accel_remove_liq (generic)
- specialistRows: labeledClean=369 edgeAF=-0.1638
- uniqueMarketEventSide: labeledClean=274 edgeAF=-0.1554 uniqueEvents=319
### R7_quality_ge_065 (generic)
- specialistRows: labeledClean=107 edgeAF=-0.1950
- uniqueMarketEventSide: labeledClean=103 edgeAF=-0.1894 uniqueEvents=114
### R8_imb_and_vel (generic)
- specialistRows: labeledClean=600 edgeAF=-0.1896
- uniqueMarketEventSide: labeledClean=318 edgeAF=-0.1846 uniqueEvents=355

## Evidence after friction

```json
{
  "anyPositiveProspectiveEdgeAfterFriction": false,
  "note": "Requires labeledClean>=30 on discovery AND validation with after-friction meanSigned@3s > 0 for the SAME locked rule. Generic rules use event+side dedupe. Pseudo-holdout never used for claim.",
  "details": [
    {
      "id": "R3_vel_depth_agree",
      "setupSpecific": false,
      "discoveryEdge": -0.19000000000010914,
      "validationEdge": 0.03000000000014552,
      "discoveryN": 1,
      "validationN": 1,
      "discoveryUniqueEvents": 1,
      "validationUniqueEvents": 1,
      "bothPositive": false
    },
    {
      "id": "R4_accel_remove_liq",
      "setupSpecific": false,
      "discoveryEdge": -0.15536496350363677,
      "validationEdge": -0.1449655172414714,
      "discoveryN": 274,
      "validationN": 145,
      "discoveryUniqueEvents": 319,
      "validationUniqueEvents": 165,
      "bothPositive": false
    },
    {
      "id": "R7_quality_ge_065",
      "setupSpecific": false,
      "discoveryEdge": -0.18941747572813697,
      "validationEdge": -0.2550793650793934,
      "discoveryN": 103,
      "validationN": 63,
      "discoveryUniqueEvents": 114,
      "validationUniqueEvents": 73,
      "bothPositive": false
    },
    {
      "id": "R8_imb_and_vel",
      "setupSpecific": false,
      "discoveryEdge": -0.18455974842765477,
      "validationEdge": -0.18739837398378478,
      "discoveryN": 318,
      "validationN": 123,
      "discoveryUniqueEvents": 355,
      "validationUniqueEvents": 144,
      "bothPositive": false
    }
  ]
}
```

## True holdout

**null** — insufficient independent periods.

## Artifacts

- `backend/scripts/microEdge/goldHunterFastPhase1EntryEdgeCli.ts`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.json`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/PHASE1_REPORT.md`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/DATASET_INVENTORY.json`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase1-entry-edge/candidates_clean_sample.jsonl`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase2-data-capture/PHASE2_COLLECTOR_DESIGN.md`
- `backend/src/services/microEdge/goldHunter/fast/artifacts/v2-phase2-data-capture/PHASE2_COLLECTOR_DESIGN.json`