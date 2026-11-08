import { Link } from "@tanstack/react-router";
import { PageContainer, PageHeader } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FeatureOff } from "@/components/agile/feature-off";
import PageTitle from "@/components/page-title";
import useWorkspaceFeatures from "@/hooks/queries/feature-flag/use-workspace-features";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";

/**
 * P4R2-M1: a workspace settings area that exists only while its feature resolves on for the
 * workspace (features.md: `feature.sla` hides SLA policies and service calendars). Off keeps the
 * page title and shows the standard feature-off state, with "Turn on in Features" for someone
 * who can manage workspace settings (UX-1a, S2); while the workspace or its flags are still
 * loading nothing renders, so the area never fires the requests the API would answer with 404.
 */
export function WorkspaceFeatureGate({
  feature,
  off,
  title,
  description,
  children,
}: {
  feature: string;
  off: "sla";
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const features = useWorkspaceFeatures(workspace?.id);
  const { canManageWorkspaceSettings } = useWorkspacePermission();
  if (isWorkspaceLoading || !workspace || features.isLoading) return null;
  if (features.isOn(feature)) return children;
  return (
    <>
      <PageTitle title={title} />
      <PageContainer className="h-full overflow-y-auto">
        <PageHeader title={title} description={description} />
        <FeatureOff
          feature={off}
          manage={
            canManageWorkspaceSettings()
              ? {
                  label: t("common:featureOff.turnOn"),
                  render: <Link to={routes.workspaceFeatures.path} />,
                }
              : undefined
          }
        />
      </PageContainer>
    </>
  );
}
