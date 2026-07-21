import type { V4ShadowAnalysisRecord } from "../v4/shadowTypes";
import type { ScreenshotAnalysisResult, ScreenshotObservation } from "./types";

/**
 * Compare user/vision structured screenshot observations to verified live analysis.
 * Never creates a trade. Never invents live prices.
 */
export function analyseScreenshotAgainstVerified(input: {
  observations: ScreenshotObservation;
  latestAnalysis?: V4ShadowAnalysisRecord | null;
}): ScreenshotAnalysisResult {
  const obs = input.observations;
  const a = input.latestAnalysis ?? null;
  const agreements: string[] = [];
  const disagreements: string[] = [];
  const explanations: string[] = [];

  if (!a) {
    return {
      observations: obs,
      verifiedComparison: {
        livePoc: null,
        liveVah: null,
        liveVal: null,
        liveBias: null,
        liveSession: null,
        liveRegime: null
      },
      agreements: [],
      disagreements: [],
      explanations: [
        "Insufficient verified market data to compare against the screenshot.",
        "Screenshot alone never creates a trade."
      ],
      createsTrade: false,
      insufficientVerifiedData: true,
      visionOcr: false,
      beta: true,
      disclaimer:
        "Screenshot Comparison — Beta. Does not OCR prices from images. Does not treat screenshot values as verified market data. Compares user-provided context to verified GoldMeta data only. Cannot create or modify a setup. Broker DISABLED."
    };
  }

  const verified = {
    livePoc: a.xauPoc,
    liveVah: a.vah,
    liveVal: a.val,
    liveBias: a.bias,
    liveSession: a.session,
    liveRegime: a.regime
  };

  if (obs.session && a.session) {
    if (obs.session.toUpperCase() === a.session.toUpperCase()) {
      agreements.push(`Session agrees: ${a.session}.`);
    } else {
      disagreements.push(
        `Screenshot session=${obs.session} vs verified session=${a.session}.`
      );
      explanations.push("Session labels can differ by timezone or chart template.");
    }
  }

  const near = (x: number | null | undefined, y: number | null | undefined, tol = 2) =>
    x != null && y != null && Math.abs(x - y) <= tol;

  if (obs.visibleVolumeProfile?.poc != null && a.xauPoc != null) {
    if (near(obs.visibleVolumeProfile.poc, a.xauPoc)) {
      agreements.push(`POC roughly agrees (screenshot ${obs.visibleVolumeProfile.poc} vs verified ${a.xauPoc}).`);
    } else {
      disagreements.push(
        `POC mismatch: screenshot ${obs.visibleVolumeProfile.poc} vs verified ${a.xauPoc}.`
      );
      explanations.push(
        "Profile windows, contracts, or delayed feeds can shift POC — trust verified backend profile for decisions."
      );
    }
  }

  if (obs.trend && a.bias) {
    const bullish = /up|bull|buy/i.test(obs.trend);
    const bearish = /down|bear|sell/i.test(obs.trend);
    if ((bullish && a.bias.includes("BUY")) || (bearish && a.bias.includes("SELL"))) {
      agreements.push(`Trend reading aligns with verified bias ${a.bias}.`);
    } else if (bullish || bearish) {
      disagreements.push(
        `Trend reading (${obs.trend}) disagrees with verified bias ${a.bias}.`
      );
      explanations.push("V4 bias comes from regime engine + HTF context on confirmed bars, not chart ink.");
    }
  }

  if (!agreements.length && !disagreements.length) {
    explanations.push(
      "Provide structured observations (session, POC/VAH/VAL, trend) to enable a concrete comparison."
    );
  }
  explanations.push("Never create a trade solely from the screenshot.");

  return {
    observations: obs,
    verifiedComparison: verified,
    agreements,
    disagreements,
    explanations,
    createsTrade: false,
    insufficientVerifiedData: false,
    visionOcr: false,
    beta: true,
    disclaimer:
      "Screenshot Comparison — Beta. Does not OCR prices from images. Does not treat screenshot values as verified market data. Compares user-provided context to verified GoldMeta data only. Cannot create or modify a setup. Broker DISABLED."
  };
}
