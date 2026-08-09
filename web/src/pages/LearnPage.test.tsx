import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LearnPage } from "./LearnPage";
import { LEARN_LESSONS } from "../lib/learn/lessons";
import { lessonScript } from "../lib/learn/types";

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

  it("shows AutoTrade lesson safety language", () => {
    renderLearn("/learn/autotrade-explained");
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

  it("exposes play pause restart controls when speech is available", async () => {
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
      lang = "en-US";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((ev: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

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
            voiceURI: "test-en",
            name: "Test English",
            lang: "en-US",
            localService: true,
            default: true
          }
        ],
        onvoiceschanged: null
      }
    });

    // Re-import controller path uses window at call time — play through UI.
    const user = userEvent.setup();
    renderLearn("/learn/what-is-trading");
    const player = screen.getByTestId("learn-audio-player");
    expect(within(player).getByTestId("learn-audio-play-pause")).toBeInTheDocument();
    expect(within(player).getByTestId("learn-audio-restart")).toBeInTheDocument();
    await user.click(within(player).getByTestId("learn-audio-play-pause"));
    expect(speak).toHaveBeenCalled();
  });

  it("qualification lesson states Demo max trades and Live locked", () => {
    renderLearn("/learn/qualification-demo");
    const body = screen.getByTestId("learn-readalong");
    expect(body).toHaveTextContent(/Demo Max Trades per Day can be set up to 6/i);
    expect(body).toHaveTextContent(/Live remains LOCKED/i);
  });
});
