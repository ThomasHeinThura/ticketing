import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";

/** The portal root's not-found and error frames, loaded on demand by `routes/portal/__root.tsx`. */
function PortalFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">{children}</div>
    </main>
  );
}

export function PortalNotFound() {
  const { t } = usePortalTranslation("portal");
  return (
    <PortalFrame>
      <Alert variant="info">
        <AlertTitle>{t("notFound.title")}</AlertTitle>
        <AlertDescription>{t("notFound.description")}</AlertDescription>
      </Alert>
    </PortalFrame>
  );
}

export function PortalError({ reset }: { reset: () => void }) {
  const { t } = usePortalTranslation("portal");
  return (
    <PortalFrame>
      <Alert variant="error">
        <AlertTitle>{t("error.title")}</AlertTitle>
        <AlertDescription>{t("error.description")}</AlertDescription>
        <Button onClick={reset}>{t("common:actions.tryAgain")}</Button>
      </Alert>
    </PortalFrame>
  );
}
