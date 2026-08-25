import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LearnPage } from "./LearnPage";
import { LEARN_LESSONS } from "../lib/learn/lessons";
import { lessonScript } from "../lib/learn/types";
import { learnSpeech } from "../lib/learn/speechController";
import { TEACHER_VOICE_STORAGE_KEY } from "../lib/learn/teacherVoices";

function renderLearn(path = "/learn") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/learn/:lessonId" element={<LearnPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Learn GoldMeta", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      localStorage.removeItem(TEACHER_VOICE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    learnSpeech.stop();
    learnSpeech.setTeacherVoice("female");
  });

  it("renders home with 21 lesson cards and education disclaimer", () => {
    renderLearn("/learn");
    expect(screen.getByTestId("learn-page")).toBeInTheDocument();
    expect(screen.getByText("Learn GoldMeta")).toBeInTheDocument();
    expect(screen.getByText(/Trading explained in simple English/i)).toBeInTheDocument();
    expect(screen.getByTestId("learn-lesson-grid").querySelectorAll("a")).toHaveLength(21);
    expect(screen.getByText(/does not know the future/i)).toBeInTheDocument();
    expect(screen.getByText(/Trading can lose money/i)).toBeInTheDocument();
  });

  it("opens GoldMeta Score lesson with critical score warning", async () => {
    const user = userEvent.setup();
    renderLearn("/learn");
    await user.click(screen.getByTestId("learn-card-goldmeta-score"));
    expect(screen.getByTestId("learn-lesson-page")).toHaveAttribute(
      "data-lesson",
      "goldmeta-score"
    );
    expect(screen.getByTestId("learn-score-warning")).toHaveTextContent(
      /does NOT mean 80% chance of profit/i
    );
    expect(screen.getByTestId("learn-readalong")).toHaveTextContent(
      /does NOT mean an 80 percent chance of profit/i
    );
  });

  it("shows Market Report lesson sections in order language", () => {
    renderLearn("/learn/reading-market-report");
    expect(screen.getByTestId("learn-readalong")).toHaveTextContent(/Market Decision/i);
    expect(screen.getByTestId("learn-readalong")).toHaveTextContent(/Scenario Map/i);
  });

  it("shows Gold Hunter lesson safety language", () => {
    renderLearn("/learn/gold-hunter-explained");
    expect(screen.getByTestId("learn-readalong")).toHaveTextContent(/NOT a money button/i);
    expect(screen.getByTestId("learn-readalong")).toHaveTextContent(
      /must never start automatically/i
    );
  });

  it("keeps audio script identical to read-along content", () => {
    for (const lesson of LEARN_LESSONS) {
      const script = lessonScript(lesson);
      expect(script).toContain(lesson.title);
      expect(script).toContain(lesson.example);
      for (const tip of lesson.remember) {
        expect(script).toContain(tip);
      }
      expect(script).not.toMatch(/GoldMeta knows where price will go/i);
      expect(script).not.toMatch(/will make you rich/i);
      expect(script).not.toMatch(/easy money|get rich|guaranteed returns/i);
    }
  });

  it("exposes only Female/Male British Teacher voices and play controls", async () => {
    const speak = vi.fn((u: SpeechSynthesisUtterance) => {
      window.setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 0);
    });
    const cancel = vi.fn();
    const pause = vi.fn();
    const resume = vi.fn();

    class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      volume = 1;
      lang = "en-GB";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((ev: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    // Premium files are absent in tests — mock fetch HEAD as missing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak,
        cancel,
        pause,
        resume,
        speaking: false,
        paused: false,
        getVoices: () => [
          {
            voiceURI: "google-uk-female",
            name: "Google UK English Female",
            lang: "en-GB",
            localService: false,
            default: false
          },
          {
            voiceURI: "google-uk-male",
            name: "Google UK English Male",
            lang: "en-GB",
            localService: false,
            default: false
          },
          {
            voiceURI: "other-en",
            name: "Microsoft Hazel - English (United Kingdom)",
            lang: "en-GB",
            localService: true,
            default: false
          }
        ],
        onvoiceschanged: null
      }
    });

    const user = userEvent.setup();
    renderLearn("/learn/what-is-trading");
    const player = screen.getByTestId("learn-audio-player");
    const select = within(player).getByTestId("learn-voice-select") as HTMLSelectElement;
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Female — British Teacher");
    expect(options[1]).toHaveTextContent("Male — British Teacher");
    expect(select.value).toBe("female");
    expect(select).not.toHaveTextContent(/Google UK|Microsoft|Samantha/i);

    expect(within(player).getByTestId("learn-audio-play-pause")).toBeInTheDocument();
    expect(within(player).getByTestId("learn-audio-restart")).toBeInTheDocument();
    await user.selectOptions(select, "male");
    expect(select.value).toBe("male");
    await user.click(within(player).getByTestId("learn-audio-play-pause"));
    await waitFor(() => expect(speak).toHaveBeenCalled());
    const uttered = speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    expect(uttered.voice?.name).toBe("Google UK English Male");
  });

  it("shows UK unavailable message when approved Google UK voice is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    class MockUtterance {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        speaking: false,
        paused: false,
        getVoices: () => [
          {
            voiceURI: "hazel",
            name: "Microsoft Hazel - English (United Kingdom)",
            lang: "en-GB",
            localService: true,
            default: true
          }
        ],
        onvoiceschanged: null
      }
    });

    const user = userEvent.setup();
    renderLearn("/learn/what-is-trading");
    const player = screen.getByTestId("learn-audio-player");
    await user.click(within(player).getByTestId("learn-audio-play-pause"));
    expect(await within(player).findByTestId("learn-audio-error")).toHaveTextContent(
      /UK English audio is not available on this device/i
    );
    expect(screen.getByTestId("learn-readalong")).toBeInTheDocument();
  });

  it("qualification lesson states Core qualification was removed and Live locked", () => {
    renderLearn("/learn/qualification-demo");
    const body = screen.getByTestId("learn-readalong");
    expect(body).toHaveTextContent(/Gold Hunter is the only automatic trading engine/i);
    expect(body).toHaveTextContent(/Live remains LOCKED/i);
  });
});
