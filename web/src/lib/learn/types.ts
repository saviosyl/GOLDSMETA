/** Learn GoldMeta — education-only types (no trading logic). */

export type LessonDiagramId =
  | "candle"
  | "support-resistance"
  | "market-structure"
  | "value-area"
  | "risk-reward"
  | "buy-sell-wait"
  | "sessions"
  | "score"
  | null;

export type LearnLesson = {
  id: string;
  number: number;
  title: string;
  description: string;
  /** Estimated listening time in minutes (spoken text). */
  listenMinutes: number;
  /** Full lesson text — identical for read-along and audio. */
  body: string;
  /** One easy example, also spoken. */
  example: string;
  /** 3–5 key takeaways. */
  remember: string[];
  diagram: LessonDiagramId;
};

/** Concatenate the exact spoken / read-along script for a lesson. */
export function lessonScript(lesson: LearnLesson): string {
  const rememberBlock = lesson.remember.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return [
    lesson.title,
    lesson.body,
    `Easy example. ${lesson.example}`,
    `Key things to remember.`,
    rememberBlock
  ].join("\n\n");
}
