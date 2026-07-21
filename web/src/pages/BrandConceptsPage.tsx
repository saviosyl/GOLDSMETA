import { PageHeader, SectionCard } from "../components/ui/primitives";

/** V5.4 approved branding showcase — official GitHub-uploaded logo. */
export function BrandConceptsPage() {
  return (
    <div data-testid="brand-concepts-page" className="gm-brand-page">
      <PageHeader title="Approved branding" />
      <p className="gm-brand-intro">
        GoldMeta V5.4 uses the official logo uploaded to the repository. Previous SVG recreations and
        concept previews (A–F) are withdrawn. Production icons update with this preview until Savio
        promotes the theme.
      </p>

      <div className="gm-brand-columns" data-testid="brand-columns" style={{ gridTemplateColumns: "1fr" }}>
        <SectionCard title="Full logo">
          <div className="gm-brand-preview-grid">
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage" style={{ background: "#fff" }}>
                <img src="/brand/logo-full-official.png" alt="GoldMeta full logo" width={320} />
              </div>
              <figcaption>Official full logo</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage" style={{ background: "#fff" }}>
                <img src="/brand/logo-official.png" alt="Official source upload" width={280} />
              </div>
              <figcaption>Source upload (repo)</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <div className="gm-brand-nav-mock">
                  <img src="/brand/mark-official.png" alt="" width={28} height={28} />
                  <span>GOLDMETA</span>
                </div>
              </div>
              <figcaption>Navigation</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <img src="/brand/mark-app-official.png" alt="App icon" width={180} height={180} />
              </div>
              <figcaption>180 px app icon</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <img src="/brand/mark-official.png" alt="" width={32} height={32} />
              </div>
              <figcaption>32 px</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-preview-stage">
                <img src="/brand/mark-official.png" alt="" width={16} height={16} />
              </div>
              <figcaption>16 px</figcaption>
            </figure>
            <figure className="gm-brand-preview-block">
              <div className="gm-brand-iphone-mock">
                <img src="/brand/mark-app-official.png" alt="" width={60} height={60} />
              </div>
              <figcaption>iPhone preview</figcaption>
            </figure>
          </div>
          <p className="gm-meta" data-testid="brand-approved-note">
            Source: official PNG uploaded to GitHub (`037B42C2-623E-485F-BF35-9F3B26533445.png`).
            Mark and icons are cropped/derived from that file — not an SVG recreation.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
