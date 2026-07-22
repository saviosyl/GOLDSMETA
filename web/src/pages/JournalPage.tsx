import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import type { Decision, JournalEntry, JournalTag } from "../types/models";
import { formatWhen } from "../lib/format";

const TAG_OPTIONS: Array<{ id: JournalTag; label: string }> = [
  { id: "followed", label: "Followed" },
  { id: "ignored", label: "Ignored" },
  { id: "entered_manually", label: "Entered manually" },
  { id: "avoided", label: "Avoided" },
  { id: "news_risk", label: "News risk" },
  { id: "poor_spread", label: "Poor spread" },
  { id: "discretionary_override", label: "Discretionary override" }
];

/** Escape text content by relying on React text nodes — never dangerouslySetInnerHTML. */
export function JournalPage() {
  const { api } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [direction, setDirection] = useState<Decision["decision"]>("WAIT");
  const [tags, setTags] = useState<JournalTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (offline) return;
    setBusy(true);
    setError(null);
    try {
      await api.createJournal({
        direction,
        notes: notes.trim() || undefined,
        tags: tags.length ? tags : undefined
      });
      setNotes("");
      setTags([]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="journal-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Journal
      </h1>
      <p className="muted">Notes and tags never alter engine outcomes.</p>
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
      <div className="card">
        <h2>New entry</h2>
        <form onSubmit={onSubmit}>
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
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={offline}
            />
          </div>
          <fieldset className="field tag-fieldset" disabled={offline}>
            <legend>Tags</legend>
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
      </div>
      <div className="card">
        <h2>Recent</h2>
        <ul className="list">
          {entries.length === 0 && <li>No journal entries yet.</li>}
          {entries.map((entry) => (
            <li key={entry.journalId ?? entry.id ?? `${entry.createdAt}-${entry.direction}`}>
              <strong>{entry.direction}</strong> · {entry.outcome} · {formatWhen(entry.createdAt)}
              {entry.tags && entry.tags.length > 0 ? (
                <div className="muted">{entry.tags.join(", ")}</div>
              ) : null}
              {entry.notes ? <div className="muted">{entry.notes}</div> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
