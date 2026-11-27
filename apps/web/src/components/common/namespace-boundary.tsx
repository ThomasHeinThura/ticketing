import { Alert, AlertDescription, Button, LoadingStatus } from "@taskdesk/ui";
import {
  Activity,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { I18nContext, useTranslation } from "react-i18next";
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
 * renders `children` at once. The gate covers the initial render only: once revealed, children
 * stay mounted (hidden while a language change reloads), so drafts and focus survive. Put it
 * above the surface, not around parts of it. The build guard
 * (`WORK_ROUTE_GATED_SURFACES`) treats an import edge as gated only when the importer renders
 * this boundary.
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
  const inherited = useContext(I18nContext);
  const defaultNS = inherited?.defaultNS;
  const locale = i18n.language;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    | {
        locale: string;
        attempt: number;
        failed: boolean;
      }
    | undefined
  >(() =>
    areAllNamespacesLoaded(locale)
      ? { locale, attempt: 0, failed: false }
      : undefined,
  );
  const [revealed, setRevealed] = useState(() =>
    areAllNamespacesLoaded(locale),
  );
  useEffect(() => {
    let active = true;
    void whenAllNamespacesLoaded().then(
      () => {
        if (active) {
          setRevealed(true);
          setResult({ locale, attempt, failed: false });
        }
      },
      () => {
        if (active) setResult({ locale, attempt, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [locale, attempt]);
  const pending =
    !result || result.locale !== locale || result.attempt !== attempt;
  const failed = !pending && result.failed;
  const hidden = pending || failed;
  // Hidden children drop their i18n store listeners, so they would keep what they rendered
  // before the catalog arrived. A new context value whenever the gate flips re-renders them in
  // place; no remount, so drafts and focus survive.
  const refreshed = useMemo(
    () => ({ i18n, defaultNS, hidden, locale }),
    [i18n, defaultNS, hidden, locale],
  );
  return (
    <>
      {pending ? (fallback ?? <DefaultFallback />) : null}
      {failed ? (
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
      {revealed ? (
        <I18nContext.Provider value={refreshed}>
          <Activity mode={hidden ? "hidden" : "visible"}>{children}</Activity>
        </I18nContext.Provider>
      ) : null}
    </>
  );
}
