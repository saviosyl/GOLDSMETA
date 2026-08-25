import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

/**
 * Admin-only standard template management.
 * Authorised by OWNER/ADMIN role server-side — not email-only browser checks.
 * Never displays raw user webhook secrets or broker tokens.
 */
export function TradingViewTemplateAdminPage() {
  const { api, account } = useAuth();
  const [active, setActive] = useState<Record<string, unknown> | null>(null);
  const [templates, setTemplates] = useState<unknown[]>([]);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = (await api.getAdminTradingViewTemplate()) as {
        active: Record<string, unknown>;
        templates: unknown[];
      };
      setActive(res.active);
      setTemplates(res.templates ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Admin template access denied");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    setBusy(true);
    try {
      await api.publishAdminTradingViewTemplate({
        releaseNotes: releaseNotes || "Admin-published template update."
      });
      setMessage(
        "Published new standard template version. User webhook tokens were not modified."
      );
      setReleaseNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  };

  const role = (account?.role ?? "").toUpperCase();
  if (role !== "OWNER" && role !== "ADMIN") {
    return (
      <div className="gm-tv-setup">
        <h1 className="gm-page-title">TradingView Standard Template</h1>
        <p className="gm-error">Staff access required.</p>
      </div>
    );
  }

  return (
    <div className="gm-tv-setup" data-testid="admin-tv-template-page">
      <h1 className="gm-page-title">TradingView Standard Template</h1>
      <p className="gm-meta">
        Manage the platform standard alert template. Changes never edit private user webhook tokens
        or overwrite custom user setups.
      </p>
      {error ? <p className="gm-error">{error}</p> : null}
      {message ? <p className="gm-meta">{message}</p> : null}

      <section className="gm-tv-status-card">
        <div>
          <span className="gm-label">Active template</span>
          <strong>{String(active?.id ?? "—")}</strong>
        </div>
        <div>
          <span className="gm-label">Version</span>
          <strong>{String(active?.version ?? "—")}</strong>
        </div>
        <div>
          <span className="gm-label">Status</span>
          <strong>{String(active?.status ?? "—")}</strong>
        </div>
      </section>

      <section className="gm-tv-wizard">
        <h2 className="gm-section-title">Release notes</h2>
        <p className="gm-meta">{String(active?.releaseNotes ?? "")}</p>
        <label>
          Notes for next version
          <textarea
            rows={4}
            value={releaseNotes}
            onChange={(e) => setReleaseNotes(e.target.value)}
            placeholder="What changed for users on standard setup?"
          />
        </label>
        <button type="button" className="gm-btn gm-btn-primary" disabled={busy} onClick={() => void publish()}>
          Publish new version
        </button>
      </section>

      <section className="gm-tv-wizard">
        <h2 className="gm-section-title">Template versions</h2>
        <ul className="gm-meta">
          {templates.map((t, i) => {
            const row = t as { id?: string; version?: string; status?: string };
            return (
              <li key={`${row.id}-${i}`}>
                {row.id} · v{row.version} · {row.status}
              </li>
            );
          })}
        </ul>
        <p className="gm-meta">
          Aggregate accepted/rejected alert counts remain in operational diagnostics. Raw secrets are
          never shown here.
        </p>
      </section>
    </div>
  );
}
