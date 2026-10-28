import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { FeatureFlagsPanel } from "@/components/settings/feature-flags-panel";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/features",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();

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
        <FeatureFlagsPanel target={{ level: "project", projectId }} />
      </div>
    </>
  );
}
