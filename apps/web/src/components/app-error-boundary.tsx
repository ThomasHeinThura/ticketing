import { ErrorBoundary, type ErrorBoundaryFallbackProps } from "@taskdesk/ui";
import type React from "react";
import { ErrorDisplay } from "./ui/error-display";

function DefaultErrorFallback({
  error,
  resetError,
}: ErrorBoundaryFallbackProps) {
  return <ErrorDisplay error={error} onRetry={resetError} />;
}

type AppErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorBoundaryFallbackProps>;
};

export function AppErrorBoundary({
  children,
  fallback = DefaultErrorFallback,
}: AppErrorBoundaryProps) {
  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}
