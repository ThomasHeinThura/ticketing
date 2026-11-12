import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { whenAllNamespacesLoaded } from "@/lib/i18n";
import { WORK_LIST_PATH_PATTERN } from "@/lib/i18n/work-route-namespaces";
import WorkItemDetailLoading from "./work-item-detail-loading";

/** A direct work-list share link can open detail before the idle locale fetch finishes. */
export default function WorkItemNamespaceBoundary({
  children,
}: {
  children: ReactNode;
}) {
  if (!WORK_LIST_PATH_PATTERN.test(window.location.pathname)) return children;
  return <DeferredWorkItemNamespaces>{children}</DeferredWorkItemNamespaces>;
}

function DeferredWorkItemNamespaces({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    locale: string;
    attempt: number;
    failed: boolean;
  }>();
  useEffect(() => {
    let active = true;
    void whenAllNamespacesLoaded().then(
      () => {
        if (active) setResult({ locale, attempt, failed: false });
      },
      () => {
        if (active) setResult({ locale, attempt, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [locale, attempt]);
  if (!result || result.locale !== locale || result.attempt !== attempt)
    return <WorkItemDetailLoading />;
  if (result.failed)
    return (
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
    );
  return children;
}
