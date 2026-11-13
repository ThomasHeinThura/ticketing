import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  Skeleton,
} from "@taskdesk/ui";
import type { PortalProjectOption } from "@/fetchers/portal/projects";
import { portalProjectsOptions } from "@/hooks/queries/portal/portal-projects-options";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";

import {
  PortalProjectHealthBadge,
  PortalProjectStatusBadge,
} from "./portal-project-format";

function ProjectCard({ project }: { project: PortalProjectOption }) {
  const { t } = usePortalTranslation("portal");
  return (
    <Card className="h-full">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono">
            {project.key}
          </Badge>
          <PortalProjectStatusBadge status={project.status} />
          <PortalProjectHealthBadge health={project.health} />
        </div>
        <CardTitle className="text-base">
          <Link
            to={routes.portalProject.path}
            params={{ projectKey: project.key }}
            className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription>{t(`projects.kind.${project.kind}`)}</CardDescription>
      </CardHeader>
      <CardPanel>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">
              {t("projects.columns.actionRequired")}
            </dt>
            <dd className="tabular-nums">
              {project.counts.actionRequired > 0 ? (
                <Badge variant="warning">{project.counts.actionRequired}</Badge>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">
              {t("projects.columns.outstanding")}
            </dt>
            <dd className="font-medium tabular-nums">
              {project.counts.outstanding}
            </dd>
          </div>
        </dl>
      </CardPanel>
    </Card>
  );
}

/**
 * The Dashboard's projects card list (S4c): one card per project or managed service the caller's
 * organisation can see, with status, health and the same counts as the Projects list. It shares
 * the top-bar selector's query, so it adds no request. With `?project=KEY` only that project's
 * card is shown; an organisation with no projects shows no section.
 */
export function PortalProjectsCards({
  projectKey,
  prefetched = false,
}: {
  projectKey?: string;
  prefetched?: boolean;
}) {
  const { t } = usePortalTranslation("portal");
  const projects = useQuery({
    ...portalProjectsOptions(),
    staleTime: 60_000,
    // The dashboard loader refreshes on entry and the mount reuses that read.
    refetchOnMount: prefetched ? false : "always",
  });
  const visible = (projects.data?.data ?? []).filter(
    (project) => !projectKey || project.key === projectKey,
  );
  if (projects.isSuccess && visible.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="portal-dashboard-projects"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="portal-dashboard-projects" className="font-semibold text-base">
          {t("projects.dashboard.title")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to={routes.portalProjects.path} />}
        >
          {t("projects.dashboard.viewAll")}
        </Button>
      </div>
      {projects.isError ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("projects.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void projects.refetch()}
            >
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : projects.isPending ? (
        <div
          className="grid gap-3 sm:grid-cols-2"
          role="status"
          aria-label={t("projects.dashboard.title")}
        >
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((project) => (
            <li key={project.key}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
