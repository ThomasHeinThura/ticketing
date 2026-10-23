import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import ProjectMembersSettings from "@/components/project/members/project-members-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/members",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  return (
    <>
      <PageTitle title={t("settings:projectMembers.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:projectMembers.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:projectMembers.subtitle")}
          </p>
        </div>
        <ProjectMembersSettings key={projectId} projectId={projectId} />
      </div>
    </>
  );
}
