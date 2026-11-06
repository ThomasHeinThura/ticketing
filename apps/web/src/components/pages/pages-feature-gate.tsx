import { Empty, EmptyHeader, EmptyTitle, Skeleton } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FeatureOff } from "@/components/agile/feature-off";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useProjectFeatureState } from "@/hooks/queries/feature-flag/use-project-pages-feature";

/**
 * Renders the project's Pages screens only once the project is known to be reachable and
 * `feature.pages` resolves on, so no page request is sent that the API is certain to answer with
 * 404 (UAT role sweep: lead and viewer). The project comes from the reach-filtered project list;
 * the switch from the same resolved-features read the project tabs use, so this adds no request
 * of its own. The API stays the authority: the screens still map a 404 that arrives anyway.
 */
export function PagesFeatureGate({
  projectKey,
  children,
}: {
  projectKey: string;
  children: ReactNode;
}) {
  const { t } = useTranslation("pages");
  const { project, isLoading } = useProjectByKey(projectKey);
  const enabled = useProjectFeatureState(project?.id, "feature.pages");

  if (isLoading || (project && enabled === undefined))
    return (
      <div
        className="mx-auto flex max-w-4xl flex-col gap-3 p-4"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!project)
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Empty data-testid="pages-project-not-found">
          <EmptyHeader>
            <EmptyTitle>{t("list.notFound")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    );
  if (!enabled)
    return (
      <div className="mx-auto max-w-4xl p-4">
        <FeatureOff feature="pages" />
      </div>
    );
  return <>{children}</>;
}
