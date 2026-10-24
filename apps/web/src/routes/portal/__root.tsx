import {
  createRootRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import PortalLayout from "@/components/portal/portal-layout";
import { portalAuthClient } from "@/lib/portal-auth-client";

// The sign-in and accept-invitation pages are their own frame and are reachable without a session
// (the invitee signs in from the accept page).
const isSignIn = (pathname: string) =>
  pathname === "/sign-in" ||
  pathname === "/portal/sign-in" ||
  pathname.startsWith("/invite/");

function PortalRoot() {
  const location = useLocation();
  const { portalUserId } = Route.useRouteContext();
  return isSignIn(location.pathname) ? (
    <Outlet />
  ) : (
    <PortalLayout key={portalUserId}>
      <Outlet />
    </PortalLayout>
  );
}

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (isSignIn(location.pathname)) return;
    const result = await portalAuthClient.getSession();
    if (result.error || !result.data?.session)
      throw redirect({
        to: "/sign-in",
        search: { stage: "email", factor: "totp" },
      });
    return { portalUserId: result.data.user.id };
  },
  component: PortalRoot,
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
