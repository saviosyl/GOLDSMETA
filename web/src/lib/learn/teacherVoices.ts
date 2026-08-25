/** User-facing Learn teacher voices — never expose browser/system voice names. */

export type TeacherVoiceId = "female" | "male";

export type TeacherVoiceOption = {
  id: TeacherVoiceId;
  /** Shown in the Learn UI only. */
  label: string;
};

export const TEACHER_VOICE_OPTIONS: readonly TeacherVoiceOption[] = [
  { id: "female", label: "Female — British Teacher" },
  { id: "male", label: "Male — British Teacher" }
] as const;

export const DEFAULT_TEACHER_VOICE: TeacherVoiceId = "female";

export const TEACHER_VOICE_STORAGE_KEY = "gm-learn-teacher-voice";

export const UK_AUDIO_UNAVAILABLE_MESSAGE =
  "UK English audio is not available on this device.";

/** Exact approved Google UK fallback names (case-insensitive match). */
export const GOOGLE_UK_VOICE_NAME = {
  female: "Google UK English Female",
  male: "Google UK English Male"
} as const;

export function isTeacherVoiceId(value: string | null | undefined): value is TeacherVoiceId {
  return value === "female" || value === "male";
}

/**
 * Resolve the approved Google UK English Female/Male voice only.
 * Returns null if that exact approved voice is not installed — no other voices.
 */
export function findApprovedGoogleUkVoice(
  teacher: TeacherVoiceId,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const target = GOOGLE_UK_VOICE_NAME[teacher].toLowerCase();
  const exact = voices.find((v) => (v.name || "").trim().toLowerCase() === target);
  if (exact) return exact;
  // Allow minor spacing/punctuation variants of the same Google UK name only.
  const loose = voices.find((v) => {
    const n = (v.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    return n === target || n.replace(/[^a-z0-9]/g, "") === target.replace(/[^a-z0-9]/g, "");
  });
  return loose ?? null;
}
