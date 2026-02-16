import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected error" };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="alert alert-error">
          <div>
            <div className="font-semibold">Something went wrong.</div>
            <div className="text-sm">{this.state.message}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
