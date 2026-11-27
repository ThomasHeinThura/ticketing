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
 * `preload` starts the surface's code (its `import()`) during the boundary's first render, in
 * parallel with the string load, so the code never waits for strings. The surface is revealed
 * once BOTH have landed (a failed code load is left to the surface's own lazy boundary), so there
 * is one placeholder phase, not a strings phase followed by a code phase.
 *
 * The placeholder follows the house rule (`useDelayedPending`, like `DelayedSuspense`): nothing
 * for the first ~150 ms, and once shown it stays for at least ~300 ms, so a load that finishes
 * just after the delay never flashes a single frame. Reveal waits for that minimum; an error is
 * shown at once. `fallback` receives the `visible` flag.
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
  errorFallback,
  renderError,
}: {
  children: ReactNode;
  /** Translated loading state shown while pending; defaults to a status-only announcement. */
  fallback?: ReactNode | ((visible: boolean) => ReactNode);
  /** Starts loading the surface's code now, in parallel with the strings. */
  preload?: () => Promise<unknown>;
  /** Rendered with the error alert, e.g. an accessible name the surface's own copy would give. */
  errorFallback?: ReactNode;
  /**
   * Replaces the default error alert, e.g. so a menu keeps its error and retry inside its own
   * popup. Receives the retry action.
   */
  renderError?: (retry: () => void) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(() => areAllNamespacesLoaded(locale));
  const [failed, setFailed] = useState(false);
  // Started during the first render, not after the commit: the import is cached, so a repeat call
  // (StrictMode, remount) is free, and it runs a frame earlier than an effect would.
  // `Promise.resolve`: a loaded module's loader answers with a bare synchronous thenable.
  const [code] = useState(() =>
    !ready && preload
      ? Promise.resolve(preload()).then(
          () => undefined,
          () => undefined,
        )
      : undefined,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry.
  useEffect(() => {
    if (ready) return;
    let active = true;
    setFailed(false);
    void Promise.all([whenAllNamespacesLoaded(), code]).then(
      () => {
        if (active) setReady(true);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [ready, attempt, code]);
  // Held until the placeholder, if it was shown, has had its minimum time; errors skip the wait.
  const placeholderVisible = useDelayedPending(!ready && !failed, {
    releaseNow: failed,
  });
  const revealed = ready && !placeholderVisible;
  return (
    <>
      {revealed ? children : null}
      {!revealed && !failed
        ? typeof fallback === "function"
          ? fallback(placeholderVisible)
          : (fallback ?? <DefaultFallback visible={placeholderVisible} />)
        : null}
      {failed && renderError
        ? renderError(() => setAttempt((value) => value + 1))
        : null}
      {failed && !renderError ? errorFallback : null}
      {failed && !renderError ? (
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
