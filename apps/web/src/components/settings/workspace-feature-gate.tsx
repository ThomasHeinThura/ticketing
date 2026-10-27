import type { ReactNode } from "react";
import { FeatureOff } from "@/components/agile/feature-off";
import useWorkspaceFeatures from "@/hooks/queries/feature-flag/use-workspace-features";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/**
 * P4R2-M1: a workspace settings area that exists only while its feature resolves on for the
 * workspace (features.md: `feature.sla` hides SLA policies and service calendars). Off shows the
 * standard feature-off state; while the workspace or its flags are still loading nothing renders,
 * so the area never fires the requests the API would answer with 404.
 */
export function WorkspaceFeatureGate({
  feature,
  off,
  children,
}: {
  feature: string;
  off: "sla";
  children: ReactNode;
}) {
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const features = useWorkspaceFeatures(workspace?.id);
  if (isWorkspaceLoading || !workspace || features.isLoading) return null;
  if (features.isOn(feature)) return children;
  return (
    <div className="flex h-full w-full flex-1 items-center justify-center p-6">
      <FeatureOff feature={off} />
    </div>
  );
}
