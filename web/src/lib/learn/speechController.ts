/**
 * Learn GoldMeta audio controller.
 *
 * PRIMARY: pre-generated MP3/M4A from LEARN_AUDIO_MANIFEST
 * FALLBACK: Google UK English Female / Male only (no other browser voices)
 *
 * User-facing choices: Female — British Teacher / Male — British Teacher
 */

import { getAudioCandidates } from "./audioManifest";
import {
  DEFAULT_TEACHER_VOICE,
  TEACHER_VOICE_OPTIONS,
  TEACHER_VOICE_STORAGE_KEY,
  UK_AUDIO_UNAVAILABLE_MESSAGE,
  findApprovedGoogleUkVoice,
  isTeacherVoiceId,
  type TeacherVoiceId,
  type TeacherVoiceOption
} from "./teacherVoices";

export type SpeechVoiceOption = TeacherVoiceOption;

export type SpeechStatus = {
  /** True when HTMLAudioElement and/or speechSynthesis exist. */
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  lessonId: string | null;
  /** 0–1 progress through the current script / file */
  progress: number;
  durationSec: number | null;
  elapsedSec: number;
  /** Always the two teacher options (never browser voice lists). */
  voices: SpeechVoiceOption[];
  /** @deprecated use teacherVoice — kept for status shape stability */
  selectedVoiceURI: string | null;
  teacherVoice: TeacherVoiceId;
  /** media = premium file, tts = Google UK fallback */
  playbackMode: "idle" | "media" | "tts";
  error: string | null;
};

type Listener = (status: SpeechStatus) => void;

const DEFAULT_RATE = 0.92;
const DEFAULT_PITCH = 1;
const WPM = 145;

function estimateDurationSec(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / WPM) * 60 / rate));
}

const mediaExistsCache = new Map<string, boolean>();

async function probeMediaUrl(url: string): Promise<boolean> {
  if (mediaExistsCache.has(url)) return mediaExistsCache.get(url)!;
  if (typeof fetch !== "function") {
    mediaExistsCache.set(url, false);
    return false;
  }
  try {
    const head = await fetch(url, { method: "HEAD", cache: "force-cache" });
    if (head.ok) {
      const ct = (head.headers.get("content-type") || "").toLowerCase();
      // SPA fallbacks often return HTML 200 — reject those.
      if (ct.includes("text/html")) {
        mediaExistsCache.set(url, false);
        return false;
      }
      mediaExistsCache.set(url, true);
      return true;
    }
  } catch {
    /* try GET range / audio element below */
  }
  // Some hosts block HEAD — try a tiny ranged GET
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "force-cache"
    });
    if (res.ok || res.status === 206) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("text/html")) {
        mediaExistsCache.set(url, true);
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  mediaExistsCache.set(url, false);
  return false;
}

async function resolvePremiumAudioUrl(
  lessonId: string,
  teacher: TeacherVoiceId
): Promise<string | null> {
  const candidates = getAudioCandidates(lessonId, teacher);
  for (const url of candidates) {
    if (await probeMediaUrl(url)) return url;
  }
  return null;
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
  private teacherVoice: TeacherVoiceId = DEFAULT_TEACHER_VOICE;
  private error: string | null = null;
  private tickTimer: number | null = null;
  private playbackMode: "idle" | "media" | "tts" = "idle";
  private audioEl: HTMLAudioElement | null = null;
  private playGeneration = 0;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(TEACHER_VOICE_STORAGE_KEY);
        if (isTeacherVoiceId(saved)) this.teacherVoice = saved;
      } catch {
        this.teacherVoice = DEFAULT_TEACHER_VOICE;
      }
      if (typeof window.speechSynthesis !== "undefined") {
        window.speechSynthesis.onvoiceschanged = () => this.emit();
      }
    }
  }

  isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return (
      typeof window.speechSynthesis !== "undefined" ||
      typeof window.Audio !== "undefined"
    );
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
      voices: [...TEACHER_VOICE_OPTIONS],
      selectedVoiceURI: this.teacherVoice,
      teacherVoice: this.teacherVoice,
      playbackMode: this.playbackMode,
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

  /** No-op retained for callers; teacher voices are fixed (not browser lists). */
  refreshVoices(): SpeechVoiceOption[] {
    this.emit();
    return [...TEACHER_VOICE_OPTIONS];
  }

  getTeacherVoice(): TeacherVoiceId {
    return this.teacherVoice;
  }

  setTeacherVoice(id: TeacherVoiceId) {
    this.teacherVoice = id;
    try {
      localStorage.setItem(TEACHER_VOICE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    this.emit();
    if (this.speaking && !this.paused && this.lessonId && this.fullText) {
      const lessonId = this.lessonId;
      const text = this.fullText;
      const prog = this.progress;
      this.stopInternal(false);
      void this.play(lessonId, text, prog);
    }
  }

  /** @deprecated Use setTeacherVoice — maps female/male ids only. */
  setVoice(voiceURI: string) {
    if (isTeacherVoiceId(voiceURI)) this.setTeacherVoice(voiceURI);
  }

  async play(lessonId: string, text: string, resumeProgress = 0) {
    this.error = null;
    this.stopInternal(false);

    this.lessonId = lessonId;
    this.fullText = text;
    this.progress = Math.min(0.99, Math.max(0, resumeProgress));
    this.pausedAccumMs = 0;
    this.pauseStartedMs = null;
    this.startedAtMs = Date.now();
    this.speaking = true;
    this.paused = false;
    const gen = ++this.playGeneration;

    const premiumUrl = await resolvePremiumAudioUrl(lessonId, this.teacherVoice);
    if (gen !== this.playGeneration) return;

    if (premiumUrl) {
      await this.playMedia(premiumUrl, resumeProgress, gen);
      return;
    }

    this.playTtsFallback(text, resumeProgress);
  }

  private async playMedia(url: string, resumeProgress: number, gen: number) {
    if (typeof window === "undefined" || typeof window.Audio === "undefined") {
      this.playTtsFallback(this.fullText, resumeProgress);
      return;
    }
    const audio = new Audio();
    audio.preload = "auto";
    this.audioEl = audio;
    this.playbackMode = "media";

    const onError = () => {
      if (gen !== this.playGeneration) return;
      // File probe passed but playback failed — try Google UK TTS.
      this.teardownMedia();
      this.playTtsFallback(this.fullText, resumeProgress);
    };

    audio.addEventListener("error", onError, { once: true });
    audio.addEventListener("loadedmetadata", () => {
      if (gen !== this.playGeneration) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.durationSec = audio.duration;
        if (resumeProgress > 0) {
          audio.currentTime = resumeProgress * audio.duration;
        }
      }
      this.emit();
    });
    audio.addEventListener("timeupdate", () => {
      if (gen !== this.playGeneration || !this.audioEl) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.durationSec = audio.duration;
        this.progress = Math.min(0.99, audio.currentTime / audio.duration);
      }
      this.emit();
    });
    audio.addEventListener("ended", () => {
      if (gen !== this.playGeneration) return;
      this.progress = 1;
      this.speaking = false;
      this.paused = false;
      this.playbackMode = "idle";
      this.stopTick();
      this.emit();
    });

    audio.src = url;
    this.startTick();
    this.emit();
    try {
      await audio.play();
      if (gen !== this.playGeneration) return;
      this.speaking = true;
      this.paused = false;
      this.emit();
    } catch {
      onError();
    }
  }

  private playTtsFallback(text: string, resumeProgress: number) {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") {
      this.error = UK_AUDIO_UNAVAILABLE_MESSAGE;
      this.speaking = false;
      this.paused = false;
      this.playbackMode = "idle";
      this.emit();
      return;
    }

    const voices = window.speechSynthesis.getVoices();
    const voice = findApprovedGoogleUkVoice(this.teacherVoice, voices);
    if (!voice) {
      this.error = UK_AUDIO_UNAVAILABLE_MESSAGE;
      this.speaking = false;
      this.paused = false;
      this.playbackMode = "idle";
      // Keep lessonId so the open lesson can still show Read Along + the message.
      this.emit();
      return;
    }

    this.playbackMode = "tts";
    this.error = null;
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
    this.speakFromChunk(voice);
    this.emit();
  }

  pause() {
    if (!this.speaking || this.paused) return;
    if (this.playbackMode === "media" && this.audioEl) {
      this.audioEl.pause();
      this.paused = true;
      this.pauseStartedMs = Date.now();
      this.emit();
      return;
    }
    if (this.playbackMode === "tts" && typeof window !== "undefined") {
      window.speechSynthesis.pause();
      this.paused = true;
      this.pauseStartedMs = Date.now();
      this.emit();
    }
  }

  resume() {
    if (!this.speaking || !this.paused) return;
    if (this.pauseStartedMs != null) {
      this.pausedAccumMs += Date.now() - this.pauseStartedMs;
      this.pauseStartedMs = null;
    }
    if (this.playbackMode === "media" && this.audioEl) {
      void this.audioEl.play().catch(() => {
        this.error = "Audio stopped unexpectedly. Tap Play to try again.";
        this.speaking = false;
        this.paused = false;
        this.emit();
      });
      this.paused = false;
      this.emit();
      return;
    }
    if (this.playbackMode === "tts" && typeof window !== "undefined") {
      window.speechSynthesis.resume();
      window.setTimeout(() => {
        if (this.speaking && !this.paused && !window.speechSynthesis.speaking) {
          const voice = findApprovedGoogleUkVoice(
            this.teacherVoice,
            window.speechSynthesis.getVoices()
          );
          if (voice) this.speakFromChunk(voice);
        }
      }, 120);
      this.paused = false;
      this.emit();
    }
  }

  restart() {
    if (!this.lessonId || !this.fullText) return;
    const id = this.lessonId;
    const text = this.fullText;
    this.stopInternal(false);
    void this.play(id, text, 0);
  }

  stop() {
    this.stopInternal(true);
  }

  stopIfLesson(lessonId: string) {
    if (this.lessonId === lessonId) this.stop();
  }

  private teardownMedia() {
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.removeAttribute("src");
        this.audioEl.load();
      } catch {
        /* ignore */
      }
      this.audioEl = null;
    }
  }

  private stopInternal(emit: boolean) {
    this.playGeneration += 1;
    if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
    }
    this.teardownMedia();
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
    this.playbackMode = "idle";
    this.error = null;
    this.stopTick();
    if (emit) this.emit();
  }

  private elapsedSec(): number {
    if (this.playbackMode === "media" && this.audioEl) {
      return Math.max(0, this.audioEl.currentTime || 0);
    }
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
      if (this.playbackMode === "media" && this.audioEl && this.speaking && !this.paused) {
        const d = this.audioEl.duration;
        if (Number.isFinite(d) && d > 0) {
          this.durationSec = d;
          this.progress = Math.min(0.99, this.audioEl.currentTime / d);
        }
      } else if (this.playbackMode === "tts" && this.speaking && !this.paused) {
        if (this.durationSec && this.durationSec > 0) {
          this.progress = Math.min(0.99, this.elapsedSec() / this.durationSec);
        }
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

  private speakFromChunk(voice: SpeechSynthesisVoice) {
    if (typeof window === "undefined" || !this.speaking || this.playbackMode !== "tts") {
      return;
    }
    if (this.chunkIndex >= this.chunks.length) {
      this.progress = 1;
      this.speaking = false;
      this.paused = false;
      this.playbackMode = "idle";
      this.stopTick();
      this.emit();
      return;
    }

    const chunk = this.chunks[this.chunkIndex]!;
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = DEFAULT_RATE;
    u.pitch = DEFAULT_PITCH;
    u.volume = 1;
    u.voice = voice;
    u.lang = voice.lang || "en-GB";

    u.onend = () => {
      if (!this.speaking || this.paused || this.playbackMode !== "tts") return;
      this.chunkIndex += 1;
      this.progress = Math.min(1, this.chunkIndex / Math.max(1, this.chunks.length));
      this.speakFromChunk(voice);
      this.emit();
    };
    u.onerror = (ev) => {
      if (ev.error === "interrupted" || ev.error === "canceled") return;
      this.error = "Audio stopped unexpectedly. Tap Play to try again.";
      this.speaking = false;
      this.paused = false;
      this.playbackMode = "idle";
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
    const sentences = part.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [part];
    for (const s of sentences) {
      const t = s.trim();
      if (t) chunks.push(t);
    }
  }
  return chunks.length ? chunks : [text];
}

export const learnSpeech = new LearnSpeechController();
