import { Link } from "@tanstack/react-router";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@taskdesk/ui";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";

/**
 * Finding #7: the portal's branded not-found page. The host answers an unknown portal path with
 * HTTP 404 and the portal shell; the portal root renders this as its `notFoundComponent`.
 *
 * A signed-in customer sees it inside the portal layout (whose inset is the page's `main`) with a
 * link back to the dashboard. A visitor without a session (only reachable under the session-free
 * invitation frame; every other unknown path first sends them to sign-in) gets the portal's
 * centred frame and a link to sign in. It never echoes the requested address or any private data.
 */
export function PortalNotFoundPage({ signedIn }: { signedIn: boolean }) {
  const { t } = usePortalTranslation("portal");
  const content = (
    <Empty data-testid="portal-not-found">
      <PortalPageTitle title={t("notFound.title")} />
      <EmptyHeader>
        <EmptyTitle>
          <h1>{t("notFound.title")}</h1>
        </EmptyTitle>
        <EmptyDescription>{t("notFound.description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {signedIn ? (
          <Button
            variant="outline"
            render={<Link to={routes.portalHome.path} />}
          >
            {t("notFound.backToDashboard")}
          </Button>
        ) : (
          <Button
            render={
              <Link
                to={routes.portalSignIn.path}
                search={{ stage: "email", factor: "totp" }}
              />
            }
          >
            {t("notFound.signIn")}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
  if (signedIn) return content;
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">{content}</div>
    </main>
  );
}
