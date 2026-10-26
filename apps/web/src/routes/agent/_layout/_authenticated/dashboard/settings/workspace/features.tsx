import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { FeatureFlagsPanel } from "@/components/settings/feature-flags-panel";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/features",
)({ component: WorkspaceFeatures });

function WorkspaceFeatures() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  if (!workspace) return null;
  return (
    <>
      <PageTitle title={t("settings:workspaceFeatures.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceFeatures.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceFeatures.subtitle")}
          </p>
        </div>
        <FeatureFlagsPanel
          target={{ level: "workspace", workspaceId: workspace.id }}
        />
      </div>
    </>
  );
}
