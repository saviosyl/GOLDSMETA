import type { ReactNode } from "react";
import { PageHeader } from "../components/ui/primitives";

type MarkTheme = "dark" | "light" | "mono";

type Concept = {
  id: "D" | "E" | "F";
  title: string;
  idea: string;
  suitability: string;
  smallSize: string;
  limitation: string;
  Mark: (props: { size: number; theme: MarkTheme }) => ReactNode;
  Wordmark?: (props: { theme: MarkTheme }) => ReactNode;
};

function ConceptDMark({ size, theme }: { size: number; theme: "dark" | "light" | "mono" }) {
  const ink = theme === "light" ? "#0B0E13" : theme === "mono" ? "#F2F5F8" : "#C8A44D";
  const ground = theme === "light" ? "#F2F5F8" : theme === "mono" ? "#0B0E13" : "#0B0E13";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Concept D interlocked GM monogram"
    >
      <rect width="64" height="64" rx="14" fill={ground} />
      {/* Clear G bowl + spur */}
      <path
        d="M18 20c0-5 4.2-8.5 11-8.5 5.8 0 10.2 2.8 11.2 7.2h-6.2c-.7-1.6-2.5-2.7-5-2.7-3.4 0-5.3 1.8-5.3 4.4v14.2c0 2.8 1.9 4.6 5.3 4.6 2.7 0 4.6-1.2 5.2-3.1H40.2c-1.1 4.8-5.6 7.6-11.4 7.6-7.2 0-11.8-3.9-11.8-9.5V20z"
        fill={ink}
      />
      {/* Interlocked M stems sharing G counter space */}
      <path
        d="M34 44V20.5h5.2l5.1 14.4 5.1-14.4H54.6V44h-5.1V28.2L44.2 44h-4.6l-5.3-15.8V44H34z"
        fill={ink}
      />
    </svg>
  );
}

function ConceptEMark({ size, theme }: { size: number; theme: "dark" | "light" | "mono" }) {
  const ink = theme === "light" ? "#0B0E13" : theme === "mono" ? "#F2F5F8" : "#C8A44D";
  const ground = theme === "light" ? "#F2F5F8" : "#0B0E13";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Concept E companion mark"
    >
      <rect width="64" height="64" rx="14" fill={ground} />
      <path
        d="M18 16h14.5c8.4 0 13.5 4.6 13.5 12.2 0 5.4-2.8 9.2-7.4 10.9L46 48H38l-6.2-8.2H24V48h-6V16zm6 6.2v11.4h7.8c4.2 0 6.8-2.1 6.8-5.7s-2.6-5.7-6.8-5.7H24z"
        fill={ink}
      />
    </svg>
  );
}

function ConceptEWordmark({ theme }: { theme: "dark" | "light" | "mono" }) {
  const ink = theme === "light" ? "#0B0E13" : "#F2F5F8";
  const accent = theme === "mono" ? ink : "#C8A44D";
  return (
    <svg
      viewBox="0 0 280 48"
      width={280}
      height={48}
      role="img"
      aria-label="Concept E GoldMeta wordmark"
    >
      <text
        x="0"
        y="34"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="32"
        fontWeight="650"
        letterSpacing="-0.04em"
        fill={ink}
      >
        Gold
        <tspan fill={accent}>Meta</tspan>
      </text>
    </svg>
  );
}

function ConceptFMark({ size, theme }: { size: number; theme: "dark" | "light" | "mono" }) {
  const ink = theme === "light" ? "#0B0E13" : theme === "mono" ? "#F2F5F8" : "#F2F5F8";
  const line = theme === "mono" ? ink : theme === "light" ? "#C8A44D" : "#C8A44D";
  const ground = theme === "light" ? "#F2F5F8" : "#0B0E13";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Concept F market-structure monogram"
    >
      <rect width="64" height="64" rx="14" fill={ground} />
      {/* Single restrained structure line — not an upward profit arrow */}
      <path
        d="M12 38c6-2 10-8 14-8s7 7 12 7 8-6 14-10"
        fill="none"
        stroke={line}
        strokeWidth="2.25"
        strokeLinecap="round"
        opacity="0.85"
      />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="20"
        fontWeight="700"
        letterSpacing="-0.06em"
        fill={ink}
      >
        GM
      </text>
    </svg>
  );
}

const CONCEPTS: Concept[] = [
  {
    id: "D",
    title: "Concept D — Interlocked GM",
    idea: "A geometric G and M that share counter-space so both letters stay readable as GM, not a single ambiguous glyph.",
    suitability: "Suits GoldMeta as a precise, institutional mark without coin, shield, or badge clichés.",
    smallSize: "Letter construction holds at 16–24 px because stems and counters remain open.",
    limitation: "Slightly denser than a single-letter mark; needs adequate safe padding in circular masks.",
    Mark: ConceptDMark
  },
  {
    id: "E",
    title: "Concept E — GoldMeta wordmark",
    idea: "A refined wordmark with a restrained custom G companion icon. Tagline stays separate from the mark.",
    suitability: "Strong for headers, sign-in, and marketing surfaces where the product name should lead.",
    smallSize: "Companion icon remains legible alone at 16 px; wordmark is reserved for ≥120 px widths.",
    limitation: "Full wordmark is not intended for favicon use — use the companion icon there.",
    Mark: ConceptEMark,
    Wordmark: ConceptEWordmark
  },
  {
    id: "F",
    title: "Concept F — Market-structure monogram",
    idea: "GM lettering over one calm horizontal structure line that suggests profile context without candlesticks or profit arrows.",
    suitability: "Connects to market intelligence without promising performance.",
    smallSize: "Letters dominate at small sizes; the structure line softens rather than competing.",
    limitation: "If over-stylised, the line can read as decoration — keep stroke weight restrained.",
    Mark: ConceptFMark
  }
];

function PreviewBlock({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <figure className="gm-brand-preview-block">
      <div className="gm-brand-preview-stage">{children}</div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Brand review — Concepts D/E/F only. Production logo unchanged until Savio selects. */
export function BrandConceptsPage() {
  return (
    <div data-testid="brand-concepts-page" className="gm-brand-page">
      <PageHeader title="Brand preview" />
      <p className="gm-brand-intro">
        Three new original concepts for review (D, E, F). Concepts A–C are withdrawn. Production
        continues to use the current mark until you explicitly choose one. Taglines stay separate
        from the wordmark.
      </p>

      <div className="gm-brand-columns" data-testid="brand-columns">
        {CONCEPTS.map((c) => (
          <article key={c.id} className="gm-brand-column" data-testid={`brand-concept-${c.id}`}>
            <h2 className="gm-section-title">{c.title}</h2>
            <dl className="gm-brand-meta">
              <div>
                <dt>Visual idea</dt>
                <dd>{c.idea}</dd>
              </div>
              <div>
                <dt>Why it suits GoldMeta</dt>
                <dd>{c.suitability}</dd>
              </div>
              <div>
                <dt>Small sizes</dt>
                <dd>{c.smallSize}</dd>
              </div>
              <div>
                <dt>Limitation</dt>
                <dd>{c.limitation}</dd>
              </div>
            </dl>

            <div className="gm-brand-preview-grid">
              <PreviewBlock label="Primary (dark)">
                <c.Mark size={180} theme="dark" />
              </PreviewBlock>
              <PreviewBlock label="Light background">
                <c.Mark size={180} theme="light" />
              </PreviewBlock>
              {c.Wordmark && (
                <PreviewBlock label="Wordmark">
                  <c.Wordmark theme="dark" />
                </PreviewBlock>
              )}
              <PreviewBlock label="Navigation">
                <div className="gm-brand-nav-mock">
                  <c.Mark size={28} theme="dark" />
                  <span>GoldMeta</span>
                </div>
              </PreviewBlock>
              <PreviewBlock label="Sign-in">
                <div className="gm-brand-signin-mock">
                  <c.Mark size={36} theme="dark" />
                  <strong>Welcome back</strong>
                </div>
              </PreviewBlock>
              <PreviewBlock label="180 px app icon">
                <c.Mark size={180} theme="dark" />
              </PreviewBlock>
              <PreviewBlock label="32 px">
                <c.Mark size={32} theme="dark" />
              </PreviewBlock>
              <PreviewBlock label="16 px">
                <c.Mark size={16} theme="dark" />
              </PreviewBlock>
              <PreviewBlock label="Monochrome">
                <c.Mark size={64} theme="mono" />
              </PreviewBlock>
              <PreviewBlock label="iPhone home screen">
                <div className="gm-brand-iphone-mock">
                  <c.Mark size={60} theme="dark" />
                </div>
              </PreviewBlock>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
