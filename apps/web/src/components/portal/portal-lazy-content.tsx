import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { Component, type ComponentType, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  importWithRetry,
  isChunkLoadError,
  rememberCssPreloadFailure,
  resettableLazy,
} from "@/lib/lazy-retry";

class ContentBoundary extends Component<
  {
    children: ReactNode;
    failure: (error: unknown, reset: () => void) => ReactNode;
  },
  { error?: unknown }
> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error
      ? this.props.failure(this.state.error, () =>
          this.setState({ error: undefined }),
        )
      : this.props.children;
  }
}

function ContentError({ error, reset }: { error: unknown; reset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-background p-2">
      <Alert variant="error">
        <AlertDescription>
          {t(
            isChunkLoadError(error)
              ? "common:error.messages.chunkLoad"
              : "common:error.messages.unknown",
          )}
        </AlertDescription>
        <Button
          variant="outline"
          onClick={() =>
            isChunkLoadError(error) ? window.location.reload() : reset()
          }
        >
          {t("common:actions.retry")}
        </Button>
      </Alert>
    </div>
  );
}

/** Keep the frame mounted; a failed optional chunk is recovered where its content belongs. */
export function portalLazyContent<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  fallback: ReactNode,
) {
  const preload = rememberCssPreloadFailure(() => importWithRetry(load));
  const holder = resettableLazy(preload);
  function ResolvedContent(props: P) {
    const Child = holder.Component;
    return <Child {...props} />;
  }
  function Content(props: P) {
    return (
      <ContentBoundary
        failure={(error, reset) => <ContentError error={error} reset={reset} />}
      >
        <Suspense fallback={fallback}>
          <ResolvedContent {...props} />
        </Suspense>
      </ContentBoundary>
    );
  }
  return Object.assign(Content, { preload });
}
