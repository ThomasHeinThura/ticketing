import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
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
import type { HistoryTarget } from "@/query-client/settings-history-key";

const SettingsHistory = lazy(() =>
  import("@/components/settings/settings-history").then((m) => ({
    default: m.SettingsHistory,
  })),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/features",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();
  const access = useSettingsAccess(
    (permission) => permission.canManageProjectSettings(),
    projectId,
  );

  const target: FeatureLevel = { level: "project", projectId };
  const features = useQuery({
    queryKey: ["feature-flags", target],
    queryFn: () => getFeatures(target),
    enabled: access === "allowed",
    retry: false,
  });
  const history: HistoryTarget | undefined = workspace?.id
    ? {
        kind: "entity",
        type: "project_features",
        id: projectId,
        scope: { kind: "project", workspaceId: workspace.id, projectId },
      }
    : undefined;
  if (access !== "allowed")
    return (
      <SettingsAccessPage
        access={access}
        titleKey="settings:projectFeatures.title"
        pageTitleKey="settings:projectFeatures.pageTitle"
        descriptionKey="settings:projectFeatures.subtitle"
      />
    );
  if (isForbiddenError(features.error)) return <NoAccessPage />;
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
          {history ? (
            <Suspense fallback={null}>
              <SettingsHistory target={history} />
            </Suspense>
          ) : null}
          <FeatureFlagsPanel
            target={{ level: "project", projectId }}
            history={history}
          />
        </SettingsAccessGate>
      </div>
    </>
  );
}
