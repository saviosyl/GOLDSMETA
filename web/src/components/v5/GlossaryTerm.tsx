import { useEffect, useId, useState, type ReactNode } from "react";
import { useAuth } from "../../lib/auth";

/** Clickable glossary term — offline explanations. */
export function GlossaryTerm({
  term,
  children
}: {
  term: string;
  children?: ReactNode;
}) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<{
    term: string;
    whatItIs: string;
    whyItMatters: string;
    howGoldMetaUsesIt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open || entry) return;
    void (async () => {
      try {
        const e = await api.v5GlossaryTerm(term);
        setEntry(e);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Glossary unavailable");
      }
    })();
  }, [open, entry, api, term]);

  return (
    <span className="glossary-term-wrap">
      <button
        type="button"
        className="glossary-term"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? term}
      </button>
      {open && (
        <div className="glossary-panel card" id={panelId} role="dialog" aria-label={`${term} glossary`}>
          {error && <p className="muted">{error}</p>}
          {!error && !entry && <p className="muted">Loading…</p>}
          {entry && (
            <>
              <strong>{entry.term}</strong>
              <p>
                <span className="label">What it is</span>
                <br />
                {entry.whatItIs}
              </p>
              <p>
                <span className="label">Why it matters</span>
                <br />
                {entry.whyItMatters}
              </p>
              <p>
                <span className="label">How GoldMeta uses it</span>
                <br />
                {entry.howGoldMetaUsesIt}
              </p>
            </>
          )}
        </div>
      )}
    </span>
  );
}
