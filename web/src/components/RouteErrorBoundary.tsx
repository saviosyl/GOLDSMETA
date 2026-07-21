import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  label?: string;
};

type State = {
  error: Error | null;
};

/** Catches lazy-route and page render failures with a retry path. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[RouteErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card" data-testid="route-error-boundary" role="alert">
          <h2 className="section-title">Something went wrong</h2>
          <p className="muted">
            {this.props.label ? `${this.props.label} failed to load.` : "This page failed to load."}{" "}
            Your session and journal drafts are preserved.
          </p>
          <p className="muted">{this.state.error.message}</p>
          <button type="button" className="btn primary" onClick={this.retry}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
