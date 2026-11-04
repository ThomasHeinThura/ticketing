import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@taskdesk/ui";
import type { ReactNode } from "react";
import PageTitle from "@/components/page-title";
import { getWorkspaceResolvedFeatures } from "@/fetchers/feature-flags";
import { ReportsDisabledError } from "@/fetchers/report";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { ReportError } from "./report-detail";

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
  if (state === "on" || state === "unknown") return <>{children}</>;
  return <ReportsOff title={title} loading={state === "loading"} />;
}

function ReportsOff({ title, loading }: { title: string; loading: boolean }) {
  return (
    <>
      <PageTitle title={title} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <h1 className="font-semibold text-2xl">{title}</h1>
        {loading ? (
          <Skeleton
            className="h-40 w-full"
            data-testid="reports-feature-loading"
          />
        ) : (
          <ReportError error={new ReportsDisabledError()} />
        )}
      </div>
    </>
  );
}
