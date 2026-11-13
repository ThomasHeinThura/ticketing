import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import { FeatureFlagsPanel } from "@/components/settings/feature-flags-panel";
import {
  isForbiddenError,
  SettingsAccessGate,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import { SettingsAccessPage } from "@/components/settings/settings-access-page";
import { type FeatureLevel, getFeatures } from "@/fetchers/feature-flags";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/features",
)({ component: WorkspaceFeatures });

function WorkspaceFeatures() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const access = useSettingsAccess((permission) =>
    permission.canManageWorkspaceSettings(),
  );
  const target: FeatureLevel = {
    level: "workspace",
    workspaceId: workspace?.id ?? "",
  };
  const features = useQuery({
    queryKey: ["feature-flags", target],
    queryFn: () => getFeatures(target),
    enabled: access === "allowed" && Boolean(workspace?.id),
    retry: false,
  });
  if (access !== "allowed")
    return (
      <SettingsAccessPage
        access={access}
        titleKey="settings:workspaceFeatures.title"
        pageTitleKey="settings:workspaceFeatures.pageTitle"
        descriptionKey="settings:workspaceFeatures.subtitle"
      />
    );
  if (isForbiddenError(features.error)) return <NoAccessPage />;
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
        {/* `GET /api/workspaces/{id}/features` needs `workspace:manage_settings`. */}
        <SettingsAccessGate access={access}>
          {workspace ? (
            <FeatureFlagsPanel
              target={{ level: "workspace", workspaceId: workspace.id }}
            />
          ) : null}
        </SettingsAccessGate>
      </div>
    </>
  );
}
