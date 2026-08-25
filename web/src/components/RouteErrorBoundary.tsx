import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  attemptStaleChunkRecovery,
  hasAttemptedStaleChunkRecovery,
  isChunkLoadError
} from "../lib/staleChunkRecovery";

type Props = {
  children: ReactNode;
  label?: string;
  /** Bump remount key for non-chunk retries (provided by LazyRoute). */
  onRetry?: () => void;
};

type State = {
  error: Error | null;
  recovering: boolean;
  recoveryFailed: boolean;
};

/** Catches lazy-route and page render failures with stale-chunk recovery. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false, recoveryFailed: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[RouteErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info);
    if (isChunkLoadError(error) && !hasAttemptedStaleChunkRecovery()) {
      this.setState({ recovering: true });
      void attemptStaleChunkRecovery().then((started) => {
        if (!started) {
          this.setState({ recovering: false, recoveryFailed: true });
        }
      });
    } else if (isChunkLoadError(error) && hasAttemptedStaleChunkRecovery()) {
      this.setState({ recoveryFailed: true });
    }
  }

  private retry = (): void => {
    if (this.state.error && isChunkLoadError(this.state.error)) {
      if (!hasAttemptedStaleChunkRecovery()) {
        this.setState({ recovering: true });
        void attemptStaleChunkRecovery();
        return;
      }
      window.location.reload();
      return;
    }
    this.setState({ error: null, recovering: false, recoveryFailed: false });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (this.state.error) {
      const chunk = isChunkLoadError(this.state.error);
      if (chunk && this.state.recovering) {
        return (
          <div className="gm-section" data-testid="route-error-recovering" role="status">
            <h2 className="gm-section-title">Updating GoldMeta…</h2>
            <p className="gm-meta">A newer version is available. Reloading once to continue.</p>
          </div>
        );
      }

      if (chunk || this.state.recoveryFailed) {
        return (
          <div className="card gm-section" data-testid="route-error-boundary" role="alert">
            <h2 className="section-title">Update required</h2>
            <p className="muted" data-testid="stale-chunk-message">
              GoldMeta was updated while this page was open.
            </p>
            <p className="muted">Your session and journal drafts are preserved.</p>
            <button
              type="button"
              className="btn primary"
              data-testid="stale-chunk-reload"
              onClick={() => window.location.reload()}
            >
              Reload GoldMeta
            </button>
          </div>
        );
      }

      return (
        <div className="card" data-testid="route-error-boundary" role="alert">
          <h2 className="section-title">Something went wrong</h2>
          <p className="muted">
            {this.props.label ? `${this.props.label} failed to load.` : "This page failed to load."}{" "}
            Your session and journal drafts are preserved.
          </p>
          <button type="button" className="btn primary" onClick={this.retry}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
