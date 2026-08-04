import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, JournalEntry, JournalTag } from "../types/models";
import { formatWhen } from "../lib/format";
import { PageHeader, SectionCard } from "../components/ui/primitives";

const TAG_OPTIONS: Array<{ id: JournalTag; label: string }> = [
  { id: "followed", label: "Followed plan: YES" },
  { id: "ignored", label: "Followed plan: NO" },
  { id: "entered_manually", label: "Entered manually" },
  { id: "avoided", label: "Avoided" },
  { id: "news_risk", label: "News risk" },
  { id: "poor_spread", label: "Poor spread" },
  { id: "discretionary_override", label: "Discretionary override" }
];

type DirFilter = "ALL" | Decision["decision"];

/** Journal — main review workspace (notes never alter engine outcomes). */
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

  return (
    <div data-testid="journal-page" className="gm-journal-page">
      <PageHeader title="Journal" freshness="Review workspace" />
      <p className="gm-meta">
        Record outcomes and lessons. Notes never alter engine outcomes.{" "}
        <Link to="/history">Open read-only History archive</Link>.
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

      <SectionCard title="New entry">
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
            <legend>Followed plan / tags</legend>
            <div className="tag-grid">
              {TAG_OPTIONS.map((tag) => (
                <label key={tag.id} className="tag-option">
                  <input
                    type="checkbox"
                    checked={tags.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                  />
                  {tag.label}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn primary block" type="submit" disabled={busy || offline}>
            {busy ? "Saving…" : "Save entry"}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Recent">
        <ul className="list" data-testid="journal-recent-list">
          {filtered.length === 0 && <li>No journal entries yet.</li>}
          {filtered.map((entry) => (
            <li key={entry.journalId ?? entry.id ?? `${entry.createdAt}-${entry.direction}`}>
              <strong>{entry.direction}</strong> · {entry.outcome} · {formatWhen(entry.createdAt)}
              {entry.tags && entry.tags.length > 0 ? (
                <div className="muted">{entry.tags.join(", ")}</div>
              ) : null}
              {entry.notes ? <div className="muted">{entry.notes}</div> : null}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
