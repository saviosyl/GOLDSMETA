interface Props {
  acknowledged: boolean;
  busy?: boolean;
  onAcknowledge: () => void;
}

export function LiveForwardAck({ acknowledged, busy, onAcknowledge }: Props) {
  if (acknowledged) return null;

  return (
    <section
      className="card live-forward-ack"
      role="alertdialog"
      aria-labelledby="live-ack-title"
      aria-describedby="live-ack-body"
      data-testid="live-forward-ack"
    >
      <h2 id="live-ack-title" className="section-title">
        LIVE forward testing
      </h2>
      <p id="live-ack-body">
        LIVE forward testing is enabled. GoldMeta records analysis outcomes but does not execute
        orders. You are responsible for confirming every trade and limiting your maximum risk.
      </p>
      <button
        type="button"
        className="btn primary block"
        disabled={busy}
        onClick={onAcknowledge}
        data-testid="live-ack-button"
      >
        I understand — continue
      </button>
    </section>
  );
}
