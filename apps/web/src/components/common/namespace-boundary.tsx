import {
  Alert,
  AlertDescription,
  Button,
  LoadingStatus,
  useDelayedPending,
} from "@taskdesk/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { areAllNamespacesLoaded, whenAllNamespacesLoaded } from "@/lib/i18n";

function DefaultFallback({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  return (
    <LoadingStatus visible={visible} label={t("common:empty.loading")}>
      {null}
    </LoadingStatus>
  );
}

/**
 * Holds an optional surface until every i18n namespace of the active locale is loaded, so it
 * never paints raw keys. Outside namespace-group mode the catalog is always complete and this
 * renders `children` at once.
 *
 * `preload` starts the surface's code (its `import()`) the moment the boundary mounts, in
 * parallel with the string load, so the code never waits for strings. The placeholder is shown
 * only after the usual ~150 ms delay (`fallback` receives that `visible` flag, like
 * `DelayedSuspense`), so a fast load never flashes it.
 *
 * The gate covers the INITIAL render only. Once children are revealed they are never hidden or
 * unmounted again (hiding runs effect cleanups, which would drop drafts, upload queues and
 * previews). After a later language change the complete new locale is loaded before the
 * language switches (see `switchLanguage`), and the store's `added` event re-renders children in
 * place. Put it above the surface, not around parts of it. The build guard
 * (`WORK_ROUTE_GATED_SURFACES`) treats an import as gated only when the surface renders inside
 * this boundary's children.
 */
export default function NamespaceBoundary({
  children,
  fallback,
  preload,
}: {
  children: ReactNode;
  /** Translated loading state shown while pending; defaults to a status-only announcement. */
  fallback?: ReactNode | ((visible: boolean) => ReactNode);
  /** Starts loading the surface's code now; its result is not awaited. */
  preload?: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"ready" | "pending" | "failed">(() =>
    areAllNamespacesLoaded(locale) ? "ready" : "pending",
  );
  const [revealed, setRevealed] = useState(state === "ready");
  // Started during the first render, not after the commit: the import is cached, so a repeat call
  // (StrictMode, remount) is free, and it runs a frame earlier than an effect would.
  useState(() => {
    // `Promise.resolve`: a loaded module's loader answers with a bare synchronous thenable.
    if (!revealed) void Promise.resolve(preload?.()).catch(() => undefined);
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry.
  useEffect(() => {
    if (revealed) return;
    let active = true;
    setState("pending");
    void whenAllNamespacesLoaded().then(
      () => {
        if (active) {
          setRevealed(true);
          setState("ready");
        }
      },
      () => {
        if (active) setState("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [revealed, attempt]);
  const showPlaceholder = useDelayedPending(!revealed && state === "pending", {
    releaseNow: revealed,
    minVisibleMs: 0,
  });
  return (
    <>
      {revealed && children}
      {!revealed && state === "pending"
        ? typeof fallback === "function"
          ? fallback(showPlaceholder)
          : (fallback ?? <DefaultFallback visible={showPlaceholder} />)
        : null}
      {!revealed && state === "failed" ? (
        <div className="bg-background p-4">
          <Alert variant="error">
            <AlertDescription>
              {t("common:error.messages.unknown")}
            </AlertDescription>
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("common:actions.retry")}
            </Button>
          </Alert>
        </div>
      ) : null}
    </>
  );
}
