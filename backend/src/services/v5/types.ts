/**
 * GoldMeta V5 — Trading Intelligence Platform types.
 * Deterministic V4 remains the only source of trading decisions.
 * V5 explains, analyses, educates, compares — never overrides V4.
 */

export type VerifiedOrExplanation = "VERIFIED" | "EXPLANATION";

export interface IntelligenceCitation {
  kind: VerifiedOrExplanation;
  source: string;
  detail: string;
}

export interface IntelligenceAnswer {
  question: string;
  answer: string;
  verifiedFacts: string[];
  explanations: string[];
  citations: IntelligenceCitation[];
  insufficientData: boolean;
  disclaimer: string;
}

export interface GlossaryEntry {
  term: string;
  slug: string;
  whatItIs: string;
  whyItMatters: string;
  howGoldMetaUsesIt: string;
}

export interface GoldMetaScoreComponent {
  id: string;
  label: string;
  weight: number;
  score: number; // 0–weight
  max: number;
  reason: string;
  kind: VerifiedOrExplanation;
}

export interface GoldMetaScoreResult {
  total: number; // 0–100
  max: 100;
  components: GoldMetaScoreComponent[];
  disclaimer: "GoldMeta Score is a rules-based quality score, not the probability of profit.";
  actionable: false;
}

export interface DailyBriefing {
  date: string;
  session: string | null;
  marketRegime: string | null;
  positionVsPoc: "ABOVE_POC" | "BELOW_POC" | "AT_POC" | "UNKNOWN";
  atrLabel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  atrValue: number | null;
  levels: {
    poc: number | null;
    vah: number | null;
    val: number | null;
  };
  bias: string | null;
  news: string;
  currentState: "WAIT" | "BUY" | "SELL" | "SHADOW_ONLY" | "UNKNOWN";
  v3Decision: string | null;
  v4ShadowBias: string | null;
  verifiedFacts: string[];
  explanations: string[];
  insufficientData: boolean;
  disclaimer: string;
  actionable: false;
}

export interface LearningBucketStat {
  key: string;
  sampleSize: number;
  wins: number;
  losses: number;
  profitFactor: number | null;
  netExpectancyR: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  sampleWarning: string;
}

export interface LearningInsights {
  strategyVersion: "4";
  mode: "SHADOW";
  environment: "LIVE" | "TEST";
  resolvedSample: number;
  byStrategy: LearningBucketStat[];
  byDirection: LearningBucketStat[];
  bySession: LearningBucketStat[];
  byRegime: LearningBucketStat[];
  byDayOfWeek: LearningBucketStat[];
  byHour: LearningBucketStat[];
  insights: string[];
  disclaimer: string;
  selfModifiesRules: false;
}

export interface PremiumAnalyticsFilters {
  environment: "LIVE" | "TEST";
  strategy?: string;
  direction?: "BUY" | "SELL";
  session?: string;
  regime?: string;
}

export interface PremiumAnalytics {
  filters: PremiumAnalyticsFilters;
  totalAnalyses: number;
  candidates: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  shadowPlans: number;
  wins: number;
  losses: number;
  expectancyR: number | null;
  profitFactor: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  maxDrawdownR: number | null;
  averageHoldBars: number | null;
  averageMfe: number | null;
  averageMae: number | null;
  riskDistanceDistribution: { bucket: string; count: number }[];
  strategyComparison: LearningBucketStat[];
  sessionComparison: LearningBucketStat[];
  directionComparison: LearningBucketStat[];
  regimeComparison: LearningBucketStat[];
  sampleSize: number;
  sampleSizeWarning: string;
  unsafePlanCount: number;
  planMutationCount: number;
  actionable: false;
}

export interface PersonalBehaviourStats {
  ignoredWait: number;
  enteredTooEarly: number;
  closedTooEarly: number;
  heldTooLong: number;
  mostProfitableSession: string | null;
  worstDay: string | null;
  bestStrategy: string | null;
  largestWinningStreak: number;
  largestLosingStreak: number;
  averageR: number | null;
  averagePatienceBars: number | null;
  journalEntries: number;
  sampleWarning: string;
  private: true;
  insufficientData: boolean;
}

export interface WeeklyCoachReport {
  weekStart: string;
  weekEnd: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  tradesAvoided: number | null;
  moneyTheoreticallyProtectedNote: string;
  bestSetup: string | null;
  worstSetup: string | null;
  areasToImprove: string[];
  verifiedFacts: string[];
  insufficientData: boolean;
  disclaimer: string;
  actionable: false;
}

export interface ScreenshotObservation {
  /** User- or vision-supplied structured observations — never invented prices. */
  trend?: string | null;
  support?: number | null;
  resistance?: number | null;
  marketStructure?: string | null;
  possibleBreakout?: string | null;
  possibleLiquiditySweep?: string | null;
  session?: string | null;
  visibleVolumeProfile?: {
    poc?: number | null;
    vah?: number | null;
    val?: number | null;
  } | null;
  notes?: string | null;
  imageMeta?: {
    filename?: string;
    mimeType?: string;
    byteSize?: number;
    uploadedAt?: string;
  } | null;
}

export interface ScreenshotAnalysisResult {
  observations: ScreenshotObservation;
  verifiedComparison: {
    livePoc: number | null;
    liveVah: number | null;
    liveVal: number | null;
    liveBias: string | null;
    liveSession: string | null;
    liveRegime: string | null;
  };
  agreements: string[];
  disagreements: string[];
  explanations: string[];
  createsTrade: false;
  insufficientVerifiedData: boolean;
  disclaimer: string;
}

export interface ReplayBarFrame {
  barTime: string;
  analysisSummary: string | null;
  candidateStatus: string | null;
  planStatus: string | null;
  lifecycleNote: string | null;
  result: string | null;
}

export interface ReplaySession {
  sessionId: string;
  environment: "LIVE" | "TEST" | "RESEARCH";
  frames: ReplayBarFrame[];
  educationalOnly: true;
  insufficientData: boolean;
  disclaimer: string;
}
