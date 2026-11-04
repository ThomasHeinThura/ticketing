import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { FeatureFlagsPanel } from "@/components/settings/feature-flags-panel";
import {
  SettingsAccessGate,
  useSettingsAccess,
} from "@/components/settings/settings-access";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/features",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const access = useSettingsAccess(
    (permission) => permission.canManageProjectSettings(),
    projectId,
  );

  return (
    <>
      <PageTitle title={t("settings:projectFeatures.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:projectFeatures.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:projectFeatures.subtitle")}
          </p>
        </div>
        {/* `GET /api/projects/{id}/features` needs `project:manage_settings` at this project. */}
        <SettingsAccessGate access={access}>
          <FeatureFlagsPanel target={{ level: "project", projectId }} />
        </SettingsAccessGate>
      </div>
    </>
  );
}
