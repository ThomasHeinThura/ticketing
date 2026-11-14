import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  FeatureOff,
  LoadingStatus,
  PageContainer,
  PageHeader,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { getWorkspaceResolvedFeatures } from "@/fetchers/feature-flags";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";

export const REPORTS_FEATURE_KEY = "feature.reports";

export type ReportsFeatureState = "loading" | "on" | "off" | "unknown";

/**
 * `feature.reports` for the active workspace, from the same resolved-flag read (and cache entry)
 * the navigation uses to hide the Reports and Dashboard entries. `unknown` (the read failed) is
 * left to the report APIs, which answer 409 `feature_disabled` themselves.
 */
export function useReportsFeature(
  workspaceId: string | undefined,
): ReportsFeatureState {
  const features = useQuery({
    queryKey: ["features", "workspace", workspaceId, "resolved"],
    queryFn: () => getWorkspaceResolvedFeatures(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
  });
  if (!workspaceId || features.isPending) return "loading";
  if (features.isError) return "unknown";
  return features.data.some(
    (feature) => feature.key === REPORTS_FEATURE_KEY && feature.enabled,
  )
    ? "on"
    : "off";
}

/**
 * Every report and dashboard screen renders through this gate. With Reports off it shows the
 * "Reports are off" notice with no data request and no entry point (new report, editor) to a
 * second notice; until the flag is known it shows a skeleton, never the notice.
 */
export function ReportsFeatureGate({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { data: workspace } = useActiveWorkspace();
  const state = useReportsFeature(workspace?.id);
  const placeholderVisible = useDelayedPending(state === "loading");
  if (state === "unknown" || (state === "on" && !placeholderVisible))
    return <>{children}</>;
  return (
    <ReportsOff
      title={title}
      loading={state === "loading" || state === "on"}
      placeholderVisible={placeholderVisible}
    />
  );
}

function ReportsOff({
  title,
  loading,
  placeholderVisible,
}: {
  title: string;
  loading: boolean;
  placeholderVisible: boolean;
}) {
  const { t } = useTranslation();
  const { canManageWorkspaceSettings } = useWorkspacePermission();
  const canManage = canManageWorkspaceSettings();
  return (
    <>
      <PageTitle title={title} />
      <PageContainer>
        <PageHeader title={title} />
        {loading ? (
          <LoadingStatus
            visible={placeholderVisible}
            label={t("common:empty.loading")}
          >
            <Skeleton
              className="h-40 w-full"
              style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
              data-testid="reports-feature-loading"
            />
          </LoadingStatus>
        ) : (
          // UX-1a (SR-02): the shared off state, with the way to switch it on for an admin.
          <FeatureOff
            data-testid="feature-off-reports"
            title={t("reports:errors.disabled.title")}
            description={
              canManage
                ? t("reports:errors.disabled.manageDescription")
                : t("reports:errors.disabled.description")
            }
            action={
              canManage
                ? {
                    label: t("common:featureOff.turnOn"),
                    render: <Link to={routes.workspaceFeatures.path} />,
                  }
                : undefined
            }
          />
        )}
      </PageContainer>
    </>
  );
}
