/**
 * Learn GoldMeta — pre-generated narration manifest.
 *
 * Drop premium files under `web/public/learn-audio/` using these names.
 * Both `.mp3` and `.m4a` are probed (mp3 first, then m4a).
 * Do not commit placeholder/fake audio — missing files fall back to Google UK TTS.
 *
 * Example:
 *   public/learn-audio/01-what-is-trading-female.mp3
 *   public/learn-audio/01-what-is-trading-male.mp3
 */

import { LEARN_LESSONS } from "./lessons";
import type { TeacherVoiceId } from "./teacherVoices";

export type LessonAudioManifestEntry = {
  lessonId: string;
  number: number;
  /** Filename slug, e.g. what-is-trading */
  slug: string;
  /** Candidate URLs for female narration (mp3 then m4a). */
  female: string[];
  /** Candidate URLs for male narration (mp3 then m4a). */
  male: string[];
};

const AUDIO_BASE = "/learn-audio";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function candidates(number: number, slug: string, gender: TeacherVoiceId): string[] {
  const base = `${AUDIO_BASE}/${pad2(number)}-${slug}-${gender}`;
  return [`${base}.mp3`, `${base}.m4a`];
}

/** Build the full lesson → audio file map from the lesson catalogue. */
export function buildLearnAudioManifest(): LessonAudioManifestEntry[] {
  return LEARN_LESSONS.map((lesson) => ({
    lessonId: lesson.id,
    number: lesson.number,
    slug: lesson.id,
    female: candidates(lesson.number, lesson.id, "female"),
    male: candidates(lesson.number, lesson.id, "male")
  }));
}

export const LEARN_AUDIO_MANIFEST: LessonAudioManifestEntry[] = buildLearnAudioManifest();

export function getLessonAudioEntry(lessonId: string): LessonAudioManifestEntry | null {
  return LEARN_AUDIO_MANIFEST.find((e) => e.lessonId === lessonId) ?? null;
}

export function getAudioCandidates(
  lessonId: string,
  teacher: TeacherVoiceId
): string[] {
  const entry = getLessonAudioEntry(lessonId);
  if (!entry) return [];
  return teacher === "female" ? entry.female : entry.male;
}

/**
 * How to add premium narration later:
 * 1. Generate warm British Teacher MP3 (or M4A) for each lesson + gender.
 * 2. Name files exactly as listed in LEARN_AUDIO_MANIFEST (e.g. 01-what-is-trading-female.mp3).
 * 3. Place them in web/public/learn-audio/ (served at /learn-audio/...).
 * 4. Redeploy the web frontend — no lesson script changes required.
 * The player probes each candidate URL; the first that loads is used.
 */
export const LEARN_AUDIO_ADD_FILES_HINT =
  "Add premium files under web/public/learn-audio/ using the LEARN_AUDIO_MANIFEST names (mp3 or m4a).";
