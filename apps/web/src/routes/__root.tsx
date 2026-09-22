import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ErrorDisplay } from "@/components/ui/error-display";
import { ToastProvider } from "@/components/ui/toast";
import type { User } from "@/types/user";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  user: User | null | undefined;
}>()({
  component: RootComponent,
  // A route's `beforeLoad`/`loader` can still throw something other than a
  // `redirect`/`notFound` (see #97: a plain TypeError from bad location
  // handling). With no errorComponent anywhere in the tree, TanStack Router
  // warns "the following error wasn't caught by any route" and renders
  // nothing, leaving the user on a blank page with no way back. This root
  // errorComponent is the last-resort catch-all so any such throw shows a
  // real, recoverable error screen instead.
  errorComponent: RootErrorComponent,
});

function RootErrorComponent({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  return <ErrorDisplay error={error} onRetry={reset} />;
}

function RootComponent() {
  return (
    <ToastProvider position="bottom-right">
      <div className="flex h-svh w-full flex-row overflow-x-hidden overflow-y-hidden bg-background scrollbar-thin scrollbar-thumb-border scrollbar-track-muted">
        <Outlet />
      </div>
    </ToastProvider>
  );
}

export default RootComponent;
