import type { ReactNode } from "react";

type Tone = "ok" | "amber" | "live" | "locked" | "off" | "red" | "navy";

export function PremiumStatusChip(props: {
  tone: Tone;
  children: ReactNode;
  withDot?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <span
      className={`gm-prem-chip gm-prem-chip--${props.tone}${
        props.className ? ` ${props.className}` : ""
      }`}
      data-testid={props.testId}
    >
      {props.withDot ? <span className="gm-prem-dot" aria-hidden="true" /> : null}
      {props.children}
    </span>
  );
}
