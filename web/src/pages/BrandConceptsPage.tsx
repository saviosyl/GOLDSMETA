import { PageHeader, SectionCard } from "../components/ui/primitives";

/** V5.4 approved branding showcase — production assets pending promotion. */
export function BrandConceptsPage() {
  return (
    <div data-testid="brand-concepts-page" className="gm-brand-page">
      <PageHeader title="Approved branding" />
      <p className="gm-brand-intro">
        GoldMeta V5.4 uses the approved navy + gold mark and wordmark. Previous concept previews
        (A–F) are withdrawn. Production icons update with this preview until Savio promotes the
        theme.
      </p>

      <div className="gm-brand-columns" data-testid="brand-columns" style={{ gridTemplateColumns: "1fr" }}>
        <SectionCard title="Full logo">
          <div className="gm-brand-preview-grid">
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage" style={{ background: "#fff" }}>
                <img src="/brand/logo-full-v54.svg" alt="GoldMeta full logo" width={320} />
              </div>
              <figcaption>Light background</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage" style={{ background: "#11284A" }}>
                <img src="/brand/logo-full-v54.svg" alt="" width={320} style={{ filter: "brightness(1.05)" }} />
              </div>
              <figcaption>Navy surface preview</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <div className="gm-brand-nav-mock">
                  <img src="/brand/mark-v54.svg" alt="" width={28} height={28} />
                  <span>GOLDMETA</span>
                </div>
              </div>
              <figcaption>Navigation</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <img src="/brand/mark-app-v54.svg" alt="App icon" width={180} height={180} />
              </div>
              <figcaption>180 px app icon</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <img src="/brand/mark-v54.svg" alt="" width={32} height={32} />
              </div>
              <figcaption>32 px</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <img src="/brand/mark-v54.svg" alt="" width={16} height={16} />
              </div>
              <figcaption>16 px</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-iphone-mock">
                <img src="/brand/mark-app-v54.svg" alt="" width={60} height={60} />
              </div>
              <figcaption>iPhone preview</figcaption>
            </figure>
          </div>
          <p className="gm-meta" data-testid="brand-approved-note">
            Symbol: navy G with gold M, chart bars, growth accent, and circuit nodes. Wordmark:
            GOLD in premium gold, META in navy. Tagline remains secondary.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
