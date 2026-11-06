import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { getWorkspaceResolvedFeatures } from "@/fetchers/feature-flags";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

const KB_FEATURE = "feature.knowledge_base";

/**
 * Renders the agent knowledge base screens only while `feature.knowledge_base` resolves on for
 * the active workspace, so no KB request is sent that the API is certain to answer with 404 (UAT
 * role sweep: the list fired three). Off shows one calm notice, not error text. The read is the
 * same cache entry the navigation uses (`useWorkspaceFeatures`), so it adds no request of its own;
 * a failed read shows Retry rather than claiming the feature is off.
 */
export function KbFeatureGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: workspace, isLoading: loadingWorkspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const features = useQuery({
    queryKey: ["features", "workspace", workspaceId, "resolved"],
    queryFn: () => getWorkspaceResolvedFeatures(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
  });

  if (features.isError)
    return (
      <Shell>
        <Alert variant="error" data-testid="kb-feature-error">
          <AlertTitle>{t("kb:featureState.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("kb:featureState.loadErrorDescription")}
            <Button className="w-fit" onClick={() => void features.refetch()}>
              <RefreshCw aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  if (loadingWorkspace || !workspaceId || !features.data)
    return (
      <Shell>
        <div role="status" aria-label={t("kb:list.loading")}>
          <Skeleton className="h-24 w-full" />
        </div>
      </Shell>
    );
  const on = features.data.some(
    (feature) => feature.key === KB_FEATURE && feature.enabled,
  );
  if (!on)
    return (
      <Shell>
        <Empty data-testid="feature-off-knowledge-base">
          <EmptyHeader>
            <EmptyTitle>{t("kb:featureOff.title")}</EmptyTitle>
            <EmptyDescription>
              {t("kb:featureOff.description")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Shell>
    );
  return <>{children}</>;
}

/** The KB list's page frame and heading, so the gate states sit where the list would. */
function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <PageTitle title={t("kb:list.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <h1 className="text-2xl font-semibold">{t("kb:list.title")}</h1>
        {children}
      </div>
    </>
  );
}
