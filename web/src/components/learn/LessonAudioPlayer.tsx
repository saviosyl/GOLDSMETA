import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import {
  learnSpeech,
  type SpeechStatus
} from "../../lib/learn/speechController";
import {
  TEACHER_VOICE_OPTIONS,
  type TeacherVoiceId
} from "../../lib/learn/teacherVoices";

type Props = {
  lessonId: string;
  lessonTitle: string;
  script: string;
};

function formatTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function estimateDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / 145) * 60 / 0.92));
}

/** Play / Pause / Resume / Restart with progress for one lesson. */
export function LessonAudioPlayer({ lessonId, lessonTitle, script }: Props) {
  const [status, setStatus] = useState<SpeechStatus>(() => learnSpeech.getStatus());

  useEffect(() => {
    learnSpeech.refreshVoices();
    return learnSpeech.subscribe(setStatus);
  }, []);

  useEffect(() => {
    return () => {
      learnSpeech.stopIfLesson(lessonId);
    };
  }, [lessonId]);

  const isThis =
    status.lessonId === lessonId && (status.speaking || status.paused);
  const progress = isThis ? status.progress : 0;
  const estimated = estimateDurationSec(script);
  const duration = isThis ? status.durationSec ?? estimated : estimated;
  const elapsed = isThis ? status.elapsedSec : 0;
  const teacherVoice = status.teacherVoice;

  const onPlayPause = () => {
    if (isThis && status.speaking && !status.paused) {
      learnSpeech.pause();
      return;
    }
    if (isThis && status.paused) {
      learnSpeech.resume();
      return;
    }
    void learnSpeech.play(lessonId, script, 0);
  };

  const onRestart = () => {
    if (isThis) {
      learnSpeech.restart();
    } else {
      void learnSpeech.play(lessonId, script, 0);
    }
  };

  const onTeacherChange = (value: string) => {
    learnSpeech.setTeacherVoice(value as TeacherVoiceId);
  };

  return (
    <div className="gm-learn-audio" data-testid="learn-audio-player">
      <div className="gm-learn-audio-top">
        <span className="gm-label">Audio guide</span>
        {isThis && status.speaking && !status.paused ? (
          <span className="gm-learn-audio-live" data-testid="learn-audio-playing">
            Playing: {lessonTitle}
          </span>
        ) : isThis && status.paused ? (
          <span className="gm-meta" data-testid="learn-audio-paused">
            Paused
          </span>
        ) : (
          <span className="gm-meta">Listen in simple English</span>
        )}
      </div>

      <label className="gm-learn-voice" htmlFor={`learn-voice-${lessonId}`}>
        <span className="gm-label">Teacher voice</span>
        <select
          id={`learn-voice-${lessonId}`}
          value={teacherVoice}
          onChange={(e) => onTeacherChange(e.target.value)}
          data-testid="learn-voice-select"
        >
          {TEACHER_VOICE_OPTIONS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <div className="gm-learn-audio-controls">
        <button
          type="button"
          className="gm-btn gm-btn-primary gm-learn-audio-btn"
          onClick={onPlayPause}
          data-testid="learn-audio-play-pause"
          aria-label={
            isThis && status.speaking && !status.paused ? "Pause" : "Play"
          }
        >
          {isThis && status.speaking && !status.paused ? (
            <>
              <Pause size={18} aria-hidden /> Pause
            </>
          ) : (
            <>
              <Play size={18} aria-hidden />{" "}
              {isThis && status.paused ? "Resume" : "Play"}
            </>
          )}
        </button>
        <button
          type="button"
          className="gm-btn gm-btn-secondary gm-learn-audio-btn"
          onClick={onRestart}
          data-testid="learn-audio-restart"
          aria-label="Restart"
        >
          <RotateCcw size={18} aria-hidden /> Restart
        </button>
      </div>

      <div className="gm-learn-audio-progress-wrap">
        <div
          className="gm-learn-audio-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          data-testid="learn-audio-progress"
        >
          <div
            className="gm-learn-audio-progress-bar"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="gm-learn-audio-times gm-meta">
          <span data-testid="learn-audio-elapsed">{formatTime(elapsed)}</span>
          <span data-testid="learn-audio-duration">{formatTime(duration)}</span>
        </div>
      </div>

      {status.error ? (
        <p className="gm-learn-audio-error" data-testid="learn-audio-error">
          {status.error} You can still use Read Along below.
        </p>
      ) : null}

      <p className="gm-meta gm-learn-audio-note" data-testid="learn-audio-note">
        Premium teacher audio plays when available. Otherwise GoldMeta uses the
        approved UK English teacher voice on this device.
      </p>
    </div>
  );
}
