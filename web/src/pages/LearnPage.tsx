import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, GraduationCap } from "lucide-react";
import { PageHeader, SectionCard } from "../components/ui/primitives";
import { LearnDiagram } from "../components/learn/LearnDiagrams";
import { LessonAudioPlayer } from "../components/learn/LessonAudioPlayer";
import { LEARN_LESSONS, getLessonById } from "../lib/learn/lessons";
import { lessonScript } from "../lib/learn/types";

/** Support production `/learn` and UI-review `/ui-review/learn`. */
function useLearnBase(): string {
  const { pathname } = useLocation();
  return pathname.startsWith("/ui-review") ? "/ui-review" : "";
}

/** Learn GoldMeta — beginner education with read-along audio. */
export function LearnPage() {
  const { lessonId } = useParams<{ lessonId?: string }>();
  if (lessonId) {
    return <LessonDetail lessonId={lessonId} />;
  }
  return <LearnHome />;
}

function LearnHome() {
  const base = useLearnBase();
  return (
    <div className="gm-learn-page" data-testid="learn-page">
      <div className="gm-page-hero-navy gm-learn-hero">
        <div className="gm-learn-hero-icon" aria-hidden>
          <GraduationCap size={28} strokeWidth={2} />
        </div>
        <PageHeader
          title="Learn GoldMeta"
          freshness="Trading explained in simple English."
        />
        <p className="gm-learn-hero-note">
          Education only. GoldMeta helps you understand market conditions. It does not know
          the future. Trading can lose money.
        </p>
      </div>

      <SectionCard title="How to use Learn">
        <ol className="gm-help-steps" data-testid="learn-how-to">
          <li>Pick a lesson card below.</li>
          <li>Tap Play to hear the guide, or read along.</li>
          <li>Audio and text always say the same thing.</li>
          <li>
            For day-to-day “how do I use this screen?”, also see{" "}
            <Link to={`${base}/help`}>Help</Link>.
          </li>
        </ol>
      </SectionCard>

      <div className="gm-learn-grid" data-testid="learn-lesson-grid">
        {LEARN_LESSONS.map((lesson) => (
          <Link
            key={lesson.id}
            to={`${base}/learn/${lesson.id}`}
            className="gm-learn-card"
            data-testid={`learn-card-${lesson.id}`}
          >
            <span className="gm-learn-card-num">
              {String(lesson.number).padStart(2, "0")}
            </span>
            <span className="gm-learn-card-body">
              <strong className="gm-learn-card-title">{lesson.title}</strong>
              <span className="gm-meta">{lesson.description}</span>
              <span className="gm-learn-card-meta">
                About {lesson.listenMinutes} min listen
              </span>
            </span>
            <ChevronRight className="gm-learn-card-chevron" size={18} aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}

function LessonDetail({ lessonId }: { lessonId: string }) {
  const base = useLearnBase();
  const lesson = getLessonById(lessonId);
  if (!lesson) {
    return (
      <div className="gm-learn-page" data-testid="learn-lesson-missing">
        <PageHeader title="Lesson not found" freshness="Pick another lesson." />
        <Link to={`${base}/learn`} className="gm-btn gm-btn-secondary">
          Back to Learn
        </Link>
      </div>
    );
  }

  const script = lessonScript(lesson);
  const prev = LEARN_LESSONS.find((l) => l.number === lesson.number - 1) ?? null;
  const next = LEARN_LESSONS.find((l) => l.number === lesson.number + 1) ?? null;
  const paragraphs = lesson.body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <div
      className="gm-learn-page gm-learn-lesson"
      data-testid="learn-lesson-page"
      data-lesson={lesson.id}
    >
      <Link to={`${base}/learn`} className="gm-learn-back" data-testid="learn-back">
        <ChevronLeft size={16} aria-hidden /> All lessons
      </Link>

      <header className="gm-learn-lesson-header">
        <span className="gm-learn-card-num">
          {String(lesson.number).padStart(2, "0")}
        </span>
        <PageHeader
          title={lesson.title}
          freshness={`${lesson.description} · About ${lesson.listenMinutes} min`}
        />
      </header>

      <LessonAudioPlayer
        lessonId={lesson.id}
        lessonTitle={lesson.title}
        script={script}
      />

      <LearnDiagram id={lesson.diagram} />

      <SectionCard title="Read along">
        <div className="gm-learn-readalong" data-testid="learn-readalong">
          {paragraphs.map((p, i) => (
            <p key={i} className="gm-learn-para">
              {p.split("\n").map((line, j) => (
                <span key={j}>
                  {j > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ))}

          <div className="gm-learn-example" data-testid="learn-example">
            <h3 className="gm-learn-example-title">Easy example</h3>
            <p>{lesson.example}</p>
          </div>

          <div className="gm-learn-remember" data-testid="learn-remember">
            <h3 className="gm-learn-example-title">Key things to remember</h3>
            <ul>
              {lesson.remember.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <p className="gm-meta gm-learn-disclaimer" data-testid="learn-disclaimer">
        Education only. GoldMeta helps understand market conditions. It does not know the
        future. Trading can lose money.
      </p>

      <nav className="gm-learn-pager" aria-label="Lesson navigation">
        {prev ? (
          <Link
            to={`${base}/learn/${prev.id}`}
            className="gm-btn gm-btn-secondary"
            data-testid="learn-prev"
          >
            <ChevronLeft size={16} aria-hidden /> {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            to={`${base}/learn/${next.id}`}
            className="gm-btn gm-btn-primary"
            data-testid="learn-next"
          >
            {next.title} <ChevronRight size={16} aria-hidden />
          </Link>
        ) : (
          <Link
            to={`${base}/learn`}
            className="gm-btn gm-btn-primary"
            data-testid="learn-finish"
          >
            Back to all lessons
          </Link>
        )}
      </nav>
    </div>
  );
}
