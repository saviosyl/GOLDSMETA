import { describe, expect, it } from "vitest";
import { LEARN_LESSONS } from "./lessons";
import {
  LEARN_AUDIO_MANIFEST,
  getAudioCandidates,
  getLessonAudioEntry
} from "./audioManifest";
import { TEACHER_VOICE_OPTIONS } from "./teacherVoices";

describe("Learn audio manifest", () => {
  it("maps all 21 lessons to female and male mp3/m4a candidates", () => {
    expect(LEARN_AUDIO_MANIFEST).toHaveLength(21);
    expect(LEARN_AUDIO_MANIFEST).toHaveLength(LEARN_LESSONS.length);
    for (const lesson of LEARN_LESSONS) {
      const entry = getLessonAudioEntry(lesson.id);
      expect(entry).not.toBeNull();
      expect(entry!.number).toBe(lesson.number);
      expect(entry!.female[0]).toMatch(
        new RegExp(`/learn-audio/\\d{2}-${lesson.id}-female\\.mp3$`)
      );
      expect(entry!.male[0]).toMatch(
        new RegExp(`/learn-audio/\\d{2}-${lesson.id}-male\\.mp3$`)
      );
      expect(entry!.female[1]?.endsWith(".m4a")).toBe(true);
      expect(entry!.male[1]?.endsWith(".m4a")).toBe(true);
      expect(getAudioCandidates(lesson.id, "female")).toEqual(entry!.female);
      expect(getAudioCandidates(lesson.id, "male")).toEqual(entry!.male);
    }
  });

  it("exposes only two user-facing teacher voices", () => {
    expect(TEACHER_VOICE_OPTIONS).toHaveLength(2);
    expect(TEACHER_VOICE_OPTIONS.map((v) => v.label)).toEqual([
      "Female — British Teacher",
      "Male — British Teacher"
    ]);
  });
});
