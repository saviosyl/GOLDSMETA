import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEACHER_VOICE,
  UK_AUDIO_UNAVAILABLE_MESSAGE,
  findApprovedGoogleUkVoice
} from "./teacherVoices";

function voice(name: string, lang = "en-GB"): SpeechSynthesisVoice {
  return {
    voiceURI: name,
    name,
    lang,
    localService: false,
    default: false
  } as SpeechSynthesisVoice;
}

describe("teacherVoices", () => {
  it("defaults to female British Teacher", () => {
    expect(DEFAULT_TEACHER_VOICE).toBe("female");
  });

  it("matches only approved Google UK Female / Male names", () => {
    const voices = [
      voice("Google UK English Female"),
      voice("Google UK English Male"),
      voice("Microsoft Hazel - English (United Kingdom)"),
      voice("Samantha", "en-US"),
      voice("Google US English")
    ];
    expect(findApprovedGoogleUkVoice("female", voices)?.name).toBe(
      "Google UK English Female"
    );
    expect(findApprovedGoogleUkVoice("male", voices)?.name).toBe(
      "Google UK English Male"
    );
  });

  it("does not fall back to other English voices", () => {
    const voices = [
      voice("Microsoft Hazel - English (United Kingdom)"),
      voice("Samantha", "en-US"),
      voice("Google US English", "en-US")
    ];
    expect(findApprovedGoogleUkVoice("female", voices)).toBeNull();
    expect(findApprovedGoogleUkVoice("male", voices)).toBeNull();
    expect(UK_AUDIO_UNAVAILABLE_MESSAGE).toMatch(/UK English audio is not available/i);
  });
});
