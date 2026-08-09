import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import {
  learnSpeech,
  type SpeechStatus
} from "../../lib/learn/speechController";

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
  // Match speechController WPM/rate estimate (~145 wpm at 0.92)
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

  const onPlayPause = () => {
    if (!status.supported) return;
    if (isThis && status.speaking && !status.paused) {
      learnSpeech.pause();
      return;
    }
    if (isThis && status.paused) {
      learnSpeech.resume();
      return;
    }
    learnSpeech.play(lessonId, script, 0);
  };

  const onRestart = () => {
    if (!status.supported) return;
    if (isThis) {
      learnSpeech.restart();
    } else {
      learnSpeech.play(lessonId, script, 0);
    }
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

      {!status.supported ? (
        <p className="gm-meta" data-testid="learn-audio-unsupported">
          Speech is not available in this browser. You can still read the full lesson
          below — audio and text always match.
        </p>
      ) : (
        <>
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

          {status.voices.length > 0 ? (
            <label className="gm-learn-voice" htmlFor={`learn-voice-${lessonId}`}>
              <span className="gm-label">English voice</span>
              <select
                id={`learn-voice-${lessonId}`}
                value={status.selectedVoiceURI ?? ""}
                onChange={(e) => learnSpeech.setVoice(e.target.value)}
                data-testid="learn-voice-select"
              >
                {status.voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {status.error ? (
            <p className="gm-learn-audio-error" data-testid="learn-audio-error">
              {status.error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
