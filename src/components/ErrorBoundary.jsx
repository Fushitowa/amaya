import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an uncaught render error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback({ error: this.state.error, reset: this.handleReset });
      }
      return (
        <div className="p-6 m-4 bg-red-50 border border-red-200 rounded-xl text-red-800 flex flex-col gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <h3 className="text-base font-bold">Something went wrong displaying this view</h3>
          </div>
          <p className="text-xs font-mono text-red-700 bg-red-100 p-2 rounded">
            {this.state.error?.message || "An unexpected rendering error occurred."}
          </p>
          <div>
            <button
              onClick={this.handleReset}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
