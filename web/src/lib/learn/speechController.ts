/**
 * Singleton Web Speech controller for Learn GoldMeta.
 * - One utterance stream at a time across the app
 * - Natural English voice preference
 * - Rate ~0.92, normal pitch
 */

export type SpeechVoiceOption = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
};

export type SpeechStatus = {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  lessonId: string | null;
  /** 0–1 progress through the current script */
  progress: number;
  /** Estimated duration in seconds for current script */
  durationSec: number | null;
  /** Elapsed seconds estimate */
  elapsedSec: number;
  voices: SpeechVoiceOption[];
  selectedVoiceURI: string | null;
  error: string | null;
};

type Listener = (status: SpeechStatus) => void;

const STORAGE_VOICE = "gm-learn-voice-uri";
const DEFAULT_RATE = 0.92;
const DEFAULT_PITCH = 1;

/** Rough words-per-minute for duration estimates at rate 0.92. */
const WPM = 145;

function estimateDurationSec(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / WPM) * 60 / rate));
}

function scoreEnglishVoice(v: SpeechSynthesisVoice): number {
  let score = 0;
  const lang = (v.lang || "").toLowerCase();
  const name = (v.name || "").toLowerCase();
  if (lang.startsWith("en")) score += 50;
  if (lang === "en-gb" || lang === "en-us" || lang === "en-au" || lang === "en-ie") score += 20;
  if (v.localService) score += 10;
  // Prefer natural / premium sounding names when present
  if (/natural|neural|premium|enhanced|samantha|karen|daniel|moira|serena|google|microsoft/i.test(name)) {
    score += 25;
  }
  if (/compact|eloquence|robot|novelty/i.test(name)) score -= 30;
  return score;
}

class LearnSpeechController {
  private listeners = new Set<Listener>();
  private chunks: string[] = [];
  private chunkIndex = 0;
  private lessonId: string | null = null;
  private fullText = "";
  private speaking = false;
  private paused = false;
  private progress = 0;
  private durationSec: number | null = null;
  private startedAtMs: number | null = null;
  private pausedAccumMs = 0;
  private pauseStartedMs: number | null = null;
  private selectedVoiceURI: string | null = null;
  private voices: SpeechVoiceOption[] = [];
  private error: string | null = null;
  private tickTimer: number | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.selectedVoiceURI = localStorage.getItem(STORAGE_VOICE);
      } catch {
        this.selectedVoiceURI = null;
      }
      this.refreshVoices();
      if (typeof window.speechSynthesis !== "undefined") {
        window.speechSynthesis.onvoiceschanged = () => this.refreshVoices();
      }
    }
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
  }

  getStatus(): SpeechStatus {
    return {
      supported: this.isSupported(),
      speaking: this.speaking,
      paused: this.paused,
      lessonId: this.lessonId,
      progress: this.progress,
      durationSec: this.durationSec,
      elapsedSec: this.elapsedSec(),
      voices: this.voices,
      selectedVoiceURI: this.selectedVoiceURI,
      error: this.error
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const status = this.getStatus();
    for (const l of this.listeners) l(status);
  }

  refreshVoices(): SpeechVoiceOption[] {
    if (!this.isSupported()) {
      this.voices = [];
      this.emit();
      return this.voices;
    }
    const raw = window.speechSynthesis.getVoices();
    const english = raw
      .filter((v) => (v.lang || "").toLowerCase().startsWith("en"))
      .sort((a, b) => scoreEnglishVoice(b) - scoreEnglishVoice(a));
    this.voices = english.map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService
    }));
    if (
      this.selectedVoiceURI &&
      !this.voices.some((v) => v.voiceURI === this.selectedVoiceURI)
    ) {
      this.selectedVoiceURI = this.voices[0]?.voiceURI ?? null;
    }
    if (!this.selectedVoiceURI && this.voices[0]) {
      this.selectedVoiceURI = this.voices[0].voiceURI;
    }
    this.emit();
    return this.voices;
  }

  setVoice(voiceURI: string) {
    this.selectedVoiceURI = voiceURI;
    try {
      localStorage.setItem(STORAGE_VOICE, voiceURI);
    } catch {
      /* ignore */
    }
    this.emit();
    if (this.speaking && !this.paused && this.lessonId) {
      // Restart current chunk with new voice for consistency
      const id = this.lessonId;
      const text = this.fullText;
      const prog = this.progress;
      this.stopInternal(false);
      this.play(id, text, prog);
    }
  }

  play(lessonId: string, text: string, resumeProgress = 0) {
    if (!this.isSupported()) {
      this.error = "Speech is not available on this device or browser.";
      this.emit();
      return;
    }
    this.error = null;
    // Stop any other lesson
    this.stopInternal(false);

    this.lessonId = lessonId;
    this.fullText = text;
    this.chunks = splitIntoChunks(text);
    this.durationSec = estimateDurationSec(text, DEFAULT_RATE);
    this.progress = Math.min(0.99, Math.max(0, resumeProgress));
    this.chunkIndex = Math.min(
      this.chunks.length - 1,
      Math.floor(this.progress * this.chunks.length)
    );
    this.pausedAccumMs = Math.round((this.progress * (this.durationSec ?? 0)) * 1000);
    this.pauseStartedMs = null;
    this.startedAtMs = Date.now();
    this.speaking = true;
    this.paused = false;
    this.startTick();
    this.speakFromChunk();
    this.emit();
  }

  pause() {
    if (!this.isSupported() || !this.speaking || this.paused) return;
    window.speechSynthesis.pause();
    this.paused = true;
    this.pauseStartedMs = Date.now();
    this.emit();
  }

  resume() {
    if (!this.isSupported() || !this.speaking || !this.paused) return;
    if (this.pauseStartedMs != null) {
      this.pausedAccumMs += Date.now() - this.pauseStartedMs;
      this.pauseStartedMs = null;
    }
    window.speechSynthesis.resume();
    // Some browsers (iOS) drop resume — restart from current chunk if not speaking
    window.setTimeout(() => {
      if (this.speaking && this.paused === false && !window.speechSynthesis.speaking) {
        this.speakFromChunk();
      }
    }, 120);
    this.paused = false;
    this.emit();
  }

  restart() {
    if (!this.lessonId || !this.fullText) return;
    const id = this.lessonId;
    const text = this.fullText;
    this.stopInternal(false);
    this.play(id, text, 0);
  }

  stop() {
    this.stopInternal(true);
  }

  /** Call when leaving a lesson page. */
  stopIfLesson(lessonId: string) {
    if (this.lessonId === lessonId) this.stop();
  }

  private stopInternal(emit: boolean) {
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
    this.speaking = false;
    this.paused = false;
    this.lessonId = null;
    this.chunks = [];
    this.chunkIndex = 0;
    this.fullText = "";
    this.progress = 0;
    this.durationSec = null;
    this.startedAtMs = null;
    this.pausedAccumMs = 0;
    this.pauseStartedMs = null;
    this.stopTick();
    if (emit) this.emit();
  }

  private elapsedSec(): number {
    if (this.startedAtMs == null || this.durationSec == null) return 0;
    let pausedExtra = this.pausedAccumMs;
    if (this.paused && this.pauseStartedMs != null) {
      pausedExtra += Date.now() - this.pauseStartedMs;
    }
    const raw = (Date.now() - this.startedAtMs - pausedExtra) / 1000;
    return Math.max(0, Math.min(this.durationSec, raw));
  }

  private startTick() {
    this.stopTick();
    this.tickTimer = window.setInterval(() => {
      if (!this.speaking || this.paused) {
        this.emit();
        return;
      }
      if (this.durationSec && this.durationSec > 0) {
        this.progress = Math.min(0.99, this.elapsedSec() / this.durationSec);
      }
      this.emit();
    }, 250);
  }

  private stopTick() {
    if (this.tickTimer != null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private resolveVoice(): SpeechSynthesisVoice | null {
    if (!this.isSupported()) return null;
    const all = window.speechSynthesis.getVoices();
    if (this.selectedVoiceURI) {
      const match = all.find((v) => v.voiceURI === this.selectedVoiceURI);
      if (match) return match;
    }
    const english = all
      .filter((v) => (v.lang || "").toLowerCase().startsWith("en"))
      .sort((a, b) => scoreEnglishVoice(b) - scoreEnglishVoice(a));
    return english[0] ?? all[0] ?? null;
  }

  private speakFromChunk() {
    if (!this.isSupported() || !this.speaking) return;
    if (this.chunkIndex >= this.chunks.length) {
      this.progress = 1;
      this.speaking = false;
      this.paused = false;
      this.stopTick();
      this.emit();
      return;
    }

    const chunk = this.chunks[this.chunkIndex]!;
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = DEFAULT_RATE;
    u.pitch = DEFAULT_PITCH;
    u.volume = 1;
    const voice = this.resolveVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang || "en-US";
    } else {
      u.lang = "en-US";
    }

    u.onend = () => {
      if (!this.speaking || this.paused) return;
      this.chunkIndex += 1;
      this.progress = Math.min(1, this.chunkIndex / Math.max(1, this.chunks.length));
      this.speakFromChunk();
      this.emit();
    };
    u.onerror = (ev) => {
      // interrupted by cancel/restart is normal
      if (ev.error === "interrupted" || ev.error === "canceled") return;
      this.error = "Audio stopped unexpectedly. Tap Play to try again.";
      this.speaking = false;
      this.paused = false;
      this.stopTick();
      this.emit();
    };

    window.speechSynthesis.speak(u);
  }
}

function splitIntoChunks(text: string): string[] {
  const parts = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const part of parts) {
    // Split long paragraphs on sentence boundaries for smoother iOS playback
    const sentences = part.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [part];
    for (const s of sentences) {
      const t = s.trim();
      if (t) chunks.push(t);
    }
  }
  return chunks.length ? chunks : [text];
}

export const learnSpeech = new LearnSpeechController();
