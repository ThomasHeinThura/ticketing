import { Alert, AlertDescription, Button, LoadingStatus } from "@taskdesk/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { areAllNamespacesLoaded, whenAllNamespacesLoaded } from "@/lib/i18n";

function DefaultFallback() {
  const { t } = useTranslation();
  return (
    <LoadingStatus visible label={t("common:empty.loading")}>
      {null}
    </LoadingStatus>
  );
}

/**
 * Holds an optional surface until every i18n namespace of the active locale is loaded, so it
 * never paints raw keys. Outside namespace-group mode the catalog is always complete and this
 * renders `children` at once.
 *
 * The gate covers the INITIAL render only. Once children are revealed they are never hidden or
 * unmounted again (hiding runs effect cleanups, which would drop drafts, upload queues and
 * previews). After a later language change the split-out keys fall back to the already-loaded
 * fallback language until the new catalog arrives, and the store's `added` event re-renders
 * them in place. Put it above the surface, not around parts of it. The build guard
 * (`WORK_ROUTE_GATED_SURFACES`) treats an import as gated only when the surface renders inside
 * this boundary's children.
 */
export default function NamespaceBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  /** Translated loading state shown while pending; defaults to a status-only announcement. */
  fallback?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"ready" | "pending" | "failed">(() =>
    areAllNamespacesLoaded(locale) ? "ready" : "pending",
  );
  const [revealed, setRevealed] = useState(state === "ready");
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
  if (revealed) return children;
  return (
    <>
      {state === "pending" ? (fallback ?? <DefaultFallback />) : null}
      {state === "failed" ? (
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
