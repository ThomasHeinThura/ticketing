import React from "react";

export type ErrorBoundaryFallbackProps = {
  error: Error;
  resetError: () => void;
};

export type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback: React.ComponentType<ErrorBoundaryFallbackProps>;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

/** Catches render errors and lets callers supply their own fallback UI. */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.state.error) {
        const FallbackComponent = this.props.fallback;
        return (
          <FallbackComponent
            error={this.state.error}
            resetError={this.resetError}
          />
        );
      }
      return null;
    }
    return this.props.children;
  }
}
