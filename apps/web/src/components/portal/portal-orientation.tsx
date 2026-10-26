import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from "@taskdesk/ui";
import { usePortalOrientation } from "@/hooks/use-portal-orientation";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/routes";

/** CP-14: a brief, dismissible first-visit note (where to raise a request, where to see status); never a modal. */
export function PortalOrientation({ portalUserId }: { portalUserId: string }) {
  const { t } = usePortalTranslation("portal");
  const { visible, dismiss } = usePortalOrientation(portalUserId);
  if (!visible) return null;
  return (
    <Alert variant="info">
      <AlertTitle>{t("orientation.title")}</AlertTitle>
      <AlertDescription>
        <p>{t("orientation.body")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            render={<Link to={routes.portalCatalogue.path} />}
          >
            {t("orientation.raise")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={<Link to={routes.portalRequests.path} />}
          >
            {t("orientation.track")}
          </Button>
        </div>
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t("orientation.dismiss")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
