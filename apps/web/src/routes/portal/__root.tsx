import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: PortalNotFound,
  errorComponent: PortalError,
});

function PortalFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">{children}</div>
    </main>
  );
}

function PortalNotFound() {
  const { t } = useTranslation("portal");
  return (
    <PortalFrame>
      <Alert variant="info">
        <AlertTitle>{t("notFound.title")}</AlertTitle>
        <AlertDescription>{t("notFound.description")}</AlertDescription>
      </Alert>
    </PortalFrame>
  );
}

function PortalError({ reset }: { reset: () => void }) {
  const { t } = useTranslation("portal");
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

export function PortalUnavailableNotice() {
  const { t } = useTranslation("portal");
  return (
    <PortalFrame>
      <Alert variant="info">
        <AlertTitle>{t("unavailable.title")}</AlertTitle>
        <AlertDescription>{t("unavailable.description")}</AlertDescription>
      </Alert>
    </PortalFrame>
  );
}
