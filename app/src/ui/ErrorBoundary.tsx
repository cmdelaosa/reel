import { Component, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

/* Route-level error boundary — catches render/runtime errors and shows a glass
   retry card instead of a white screen. */

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Route error boundary caught:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "60dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card sheet" style={{ maxWidth: 420, padding: "30px 26px", textAlign: "center" }}>
          <h1 className="section-title" style={{ margin: 0 }}>Something broke</h1>
          <p className="dim" style={{ fontSize: 13.5, margin: "8px 0 18px" }}>
            An unexpected error occurred. Reloading usually clears it.
          </p>
          <button className="btn btn-accent" style={{ margin: "0 auto" }} onClick={() => window.location.reload()}>
            <RotateCcw size={16} />Reload
          </button>
        </div>
      </main>
    );
  }
}
