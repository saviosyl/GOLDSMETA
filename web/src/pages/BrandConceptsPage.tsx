import { PageHeader, SectionCard } from "../components/ui/primitives";

const CONCEPTS = [
  {
    id: "A",
    title: "Concept A — Geometric GM",
    body: "Clean negative-space monogram. Flat, crisp, no metallic gradients.",
    mark: (
      <svg viewBox="0 0 64 64" width="96" height="96" role="img" aria-label="Concept A">
        <rect width="64" height="64" rx="14" fill="#0B0D10" />
        <path
          d="M18 44V20h16c8 0 12 4 12 12s-4 12-12 12H28v-8h5c3 0 5-1.5 5-4s-2-4-5-4h-7v24H18zm28 0V20h8v24h-8z"
          fill="#D1A84B"
        />
      </svg>
    )
  },
  {
    id: "B",
    title: "Concept B — GM + structure line",
    body: "Compact G/M with one subtle market-structure line. Recognisable at 16 px.",
    mark: (
      <svg viewBox="0 0 64 64" width="96" height="96" role="img" aria-label="Concept B">
        <rect width="64" height="64" rx="14" fill="#0B0D10" />
        <polyline
          points="12,44 24,36 32,40 44,24 52,28"
          fill="none"
          stroke="#D1A84B"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <text
          x="32"
          y="40"
          textAnchor="middle"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="22"
          fontWeight="700"
          fill="#F4F7FA"
        >
          GM
        </text>
      </svg>
    )
  },
  {
    id: "C",
    title: "Concept C — Wordmark + small mark",
    body: "Minimal GoldMeta wordmark with a separate small application mark.",
    mark: (
      <svg viewBox="0 0 220 64" width="220" height="64" role="img" aria-label="Concept C">
        <rect x="0" y="8" width="48" height="48" rx="12" fill="#0B0D10" />
        <circle cx="24" cy="32" r="10" fill="none" stroke="#D1A84B" strokeWidth="3" />
        <path d="M24 22v20M14 32h20" stroke="#F4F7FA" strokeWidth="2.5" strokeLinecap="round" />
        <text
          x="64"
          y="40"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="28"
          fontWeight="650"
          fill="#F4F7FA"
        >
          GoldMeta
        </text>
      </svg>
    )
  }
];

/** Brand preview — do not replace production logo until Savio selects a concept. */
export function BrandConceptsPage() {
  return (
    <div data-testid="brand-concepts-page">
      <PageHeader title="Brand preview" />
      <p className="gm-meta" style={{ marginBottom: 16, maxWidth: 720 }}>
        Three original concepts for review. Production continues to use the current mark until you
        explicitly choose one. No Bitcoin, dollar, shield, or profit-arrow clichés.
      </p>
      <div className="gm-brand-grid">
        {CONCEPTS.map((c) => (
          <SectionCard key={c.id} title={c.title}>
            <p className="gm-meta">{c.body}</p>
            <div className="gm-brand-previews">
              <figure>
                {c.mark}
                <figcaption className="gm-meta">Full / nav</figcaption>
              </figure>
              <figure>
                <div style={{ transform: "scale(0.33)", transformOrigin: "bottom left" }}>{c.mark}</div>
                <figcaption className="gm-meta">32 px</figcaption>
              </figure>
              <figure>
                <div style={{ transform: "scale(0.17)", transformOrigin: "bottom left" }}>{c.mark}</div>
                <figcaption className="gm-meta">16 px</figcaption>
              </figure>
              <figure>
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "#111",
                    display: "grid",
                    placeItems: "center"
                  }}
                >
                  <div style={{ transform: "scale(0.55)" }}>{c.mark}</div>
                </div>
                <figcaption className="gm-meta">iPhone preview</figcaption>
              </figure>
              <figure>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 12,
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                    filter: "grayscale(1) contrast(1.2)"
                  }}
                >
                  <div style={{ transform: "scale(0.55)" }}>{c.mark}</div>
                </div>
                <figcaption className="gm-meta">Monochrome / light</figcaption>
              </figure>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
