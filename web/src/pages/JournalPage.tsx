import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Percent, ScrollText, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import type { Decision, JournalEntry, JournalTag } from "../types/models";
import { formatWhen } from "../lib/format";
import { EmptyState, PageHeader, SectionCard } from "../components/ui/primitives";

const TAG_OPTIONS: Array<{ id: JournalTag; label: string }> = [
  { id: "followed", label: "Followed plan" },
  { id: "ignored", label: "Did not follow" },
  { id: "entered_manually", label: "Manual" },
  { id: "avoided", label: "Avoided" },
  { id: "news_risk", label: "News risk" },
  { id: "poor_spread", label: "Poor spread" },
  { id: "discretionary_override", label: "Override" }
];

type DirFilter = "ALL" | Decision["decision"];

/** Journal — auto-journal first; manual entry is secondary. */
export function JournalPage() {
  const { api } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [lesson, setLesson] = useState("");
  const [direction, setDirection] = useState<Decision["decision"]>("WAIT");
  const [tags, setTags] = useState<JournalTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirFilter, setDirFilter] = useState<DirFilter>("ALL");
  const [showManual, setShowManual] = useState(false);
  const offline = !navigator.onLine;

  const reload = async () => {
    const list = await api.listJournal();
    setEntries(list);
  };

  useEffect(() => {
    void reload().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load journal")
    );
  }, [api]);

  const toggleTag = (tag: JournalTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const filtered = useMemo(() => {
    if (dirFilter === "ALL") return entries;
    return entries.filter((e) => e.direction === dirFilter);
  }, [entries, dirFilter]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (offline) return;
    setBusy(true);
    setError(null);
    try {
      const combined = [notes.trim(), lesson.trim() ? `Lesson: ${lesson.trim()}` : ""]
        .filter(Boolean)
        .join("\n");
      await api.createJournal({
        direction,
        notes: combined || undefined,
        tags: tags.length ? tags : undefined
      });
      setNotes("");
      setLesson("");
      setTags([]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setBusy(false);
    }
  };

  const wins = entries.filter((e) =>
    /win|profit|tp/i.test(`${e.outcome ?? ""} ${e.tags?.join(" ") ?? ""}`)
  ).length;
  const scored = entries.filter((e) => e.outcome && !/pending|open|wait/i.test(e.outcome));
  const winRate = scored.length ? Math.round((wins / scored.length) * 100) : 0;
  const netPl = entries.reduce((sum, e) => sum + (typeof e.pnl === "number" ? e.pnl : 0), 0);
  const hasPnl = entries.some((e) => typeof e.pnl === "number");

  return (
    <div data-testid="journal-page" className="gm-journal-page gm-premium-v2">
      <PageHeader title="Journal" freshness="Review workspace" />
      <div className="gm-insight-strip" style={{ marginBottom: 16 }} data-testid="journal-overview">
        <div>
          <ScrollText aria-hidden />
          <span className="gm-label">Trades</span>
          <strong>{entries.length}</strong>
        </div>
        <div>
          <Percent aria-hidden />
          <span className="gm-label">Win rate</span>
          <strong>{scored.length ? `${winRate}%` : "—"}</strong>
        </div>
        <div>
          <Wallet aria-hidden />
          <span className="gm-label">Net P/L</span>
          <strong>{hasPnl ? netPl.toFixed(2) : "—"}</strong>
        </div>
      </div>
      <p className="gm-meta">
        Recent trades, outcomes and lessons. Notes never alter engine outcomes.{" "}
        <Link to="/history-replay/history">History &amp; Replay</Link>.
      </p>
      {offline && (
        <div className="banner stale" role="status">
          Offline — journaling requires the server. Viewing is limited.
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <SectionCard title="Filters">
        <div className="gm-journal-filters" data-testid="journal-filters">
          <label htmlFor="journal-dir-filter">
            Direction
            <select
              id="journal-dir-filter"
              value={dirFilter}
              onChange={(e) => setDirFilter(e.target.value as DirFilter)}
            >
              <option value="ALL">All</option>
              <option value="BUY">Long</option>
              <option value="SELL">Short</option>
              <option value="WAIT">Wait</option>
            </select>
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Recent trades">
        {filtered.length === 0 ? (
          <EmptyState
            title="No journal entries yet"
            body="Completed Demo Auto and qualification trades appear here. You can also add a manual note."
            icon={<BookOpen aria-hidden />}
          />
        ) : (
          <ul className="list gm-journal-cards" data-testid="journal-recent-list">
            {filtered.map((entry) => (
              <li
                key={entry.journalId ?? entry.id ?? `${entry.createdAt}-${entry.direction}`}
                className="gm-journal-card"
              >
                <div className="gm-journal-card__top">
                  <strong>
                    XAUUSD · {entry.direction}
                  </strong>
                  <span className="gm-meta">{formatWhen(entry.createdAt)}</span>
                </div>
                <div className="gm-meta">{entry.outcome ?? "—"}</div>
                {entry.tags && entry.tags.length > 0 ? (
                  <div className="gm-chip-row">
                    {entry.tags.map((t) => (
                      <span key={t} className="gm-chip">
                        {t.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                ) : null}
                {entry.notes ? <p className="gm-meta">{entry.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="gm-journal-manual-toggle">
        <button
          type="button"
          className="gm-btn gm-btn--secondary"
          data-testid="journal-add-manual"
          onClick={() => setShowManual((v) => !v)}
        >
          {showManual ? "Hide manual entry" : "+ Add manual entry"}
        </button>
      </div>

      {showManual ? (
        <SectionCard title="Manual entry">
          <form onSubmit={onSubmit} data-testid="journal-new-entry">
            <div className="field">
              <label htmlFor="direction">Direction</label>
              <select
                id="direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as Decision["decision"])}
                disabled={offline}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="WAIT">WAIT</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="notes">Notes / outcome</label>
              <textarea
                id="notes"
                rows={3}
                maxLength={1600}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={offline}
                placeholder="TP1 hit, invalidated, skipped…"
              />
            </div>
            <div className="field">
              <label htmlFor="lesson">Lesson learned</label>
              <textarea
                id="lesson"
                rows={2}
                maxLength={400}
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
                disabled={offline}
                placeholder="What will you do differently?"
              />
            </div>
            <fieldset className="field tag-fieldset" disabled={offline}>
              <legend>Tags</legend>
              <div className="tag-grid gm-chip-select" role="group" aria-label="Journal tags">
                {TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`gm-chip ${tags.includes(tag.id) ? "is-selected" : ""}`}
                    aria-pressed={tags.includes(tag.id)}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button className="btn primary block" type="submit" disabled={busy || offline}>
              {busy ? "Saving…" : "Save entry"}
            </button>
          </form>
        </SectionCard>
      ) : null}
    </div>
  );
}
