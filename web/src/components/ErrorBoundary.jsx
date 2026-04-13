import React from "react";

function isChunkLoadFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk")
  );
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: null, recovering: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected error", recovering: false };
  }

  componentDidCatch(error) {
    if (!isChunkLoadFailure(error)) return;
    const recover = typeof window !== "undefined" ? window.__octoRecoverFromStaleBundle : null;
    if (typeof recover !== "function") return;
    this.setState({ recovering: true });
    Promise.resolve(recover("error-boundary"))
      .catch(() => {
        this.setState({ recovering: false });
      });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="alert alert-error">
          <div>
            <div className="font-semibold">Something went wrong.</div>
            <div className="text-sm">
              {this.state.recovering
                ? "Refreshing the app to recover from a stale desktop install."
                : this.state.message}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
