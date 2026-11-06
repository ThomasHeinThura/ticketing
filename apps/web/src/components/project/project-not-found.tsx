import { Link } from "@tanstack/react-router";
import { Alert, AlertAction, AlertDescription, Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { routes } from "@/lib/routes";

/**
 * The denial a Project URL shows when the Project does not exist or is out of the caller's
 * reach. It uses the Overview's own wording, so every Project screen (Overview, Documents,
 * Work items, Backlog, settings) answers a missing or hidden Project the same way and never
 * suggests that a retry would help.
 *
 * The denial is the screen's whole primary content, so it carries the
 * `data-primary-content-ready` marker: without it the work list's deferred UI (sidebar,
 * Project selector) waited for `afterPrimaryContent`'s fallback timer on an unknown or
 * out-of-reach Project key.
 */
export default function ProjectNotFound({
  className = "mx-auto w-full max-w-4xl p-4 md:p-6",
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={className}
      data-testid="project-not-found"
      data-primary-content-ready="true"
    >
      <Alert variant="error">
        <AlertDescription>
          {t("navigation:projectViews.notFound")}
        </AlertDescription>
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            render={<Link to={routes.agentHome.path} />}
          >
            {t("navigation:projectViews.backToProjects")}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
