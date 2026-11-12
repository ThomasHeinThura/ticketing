import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { ErrorReference } from "@/components/errors/error-reference";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";

/** The portal root's error frame, loaded on demand by `routes/portal/__root.tsx`. */
function PortalFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">{children}</div>
    </main>
  );
}

export function PortalError({
  reset,
  error,
}: {
  reset: () => void;
  error: unknown;
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <PortalFrame>
      <Alert variant="error">
        <AlertTitle>{t("error.title")}</AlertTitle>
        <AlertDescription>{t("error.description")}</AlertDescription>
        <ErrorReference error={error} />
        <Button onClick={reset}>{t("common:actions.tryAgain")}</Button>
      </Alert>
    </PortalFrame>
  );
}
