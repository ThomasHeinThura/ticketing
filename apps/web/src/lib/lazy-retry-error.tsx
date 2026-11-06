import { useRouter } from "@tanstack/react-router";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ErrorDisplay } from "@/components/errors/error-display";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/lazy-retry";

/**
 * A code chunk failed to load. `React.lazy` keeps that failure, so clearing the error boundary
 * would show it again: the page reloads once on its own (once per failing chunk, so it cannot
 * loop), and Try again reloads it on request.
 */
export function ChunkLoadErrorState({ error }: { error: unknown }) {
  const { t } = useTranslation();
  useEffect(() => {
    reloadOnceForChunkError(error);
  }, [error]);
  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <Alert variant="error">
          <AlertTitle>{t("common:error.title")}</AlertTitle>
          <AlertDescription>
            {t("common:error.messages.chunkLoad")}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw aria-hidden="true" />
              {t("common:error.tryAgain")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    </main>
  );
}

/**
 * The agent app's route error screen. A chunk load error gets the reload screen above; any
 * other error gets the styled error card, whose Try again re-runs the route checks and loaders
 * before clearing the boundary (the portal root does the same).
 */
export function AgentRouteError({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  if (isChunkLoadError(error)) return <ChunkLoadErrorState error={error} />;
  return (
    <ErrorDisplay
      error={error}
      className="min-h-svh w-full bg-background"
      onRetry={() => {
        void router.invalidate().finally(reset);
      }}
    />
  );
}
