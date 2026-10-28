import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import WorkspaceSearch from "@/components/search/workspace-search";
import { parseAgentGlobalSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/search",
)({
  validateSearch: parseAgentGlobalSearch,
  component: SearchComponent,
});

function SearchComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageTitle title={t("workspace:search.pageTitle")} />
      <WorkspaceLayout
        title={t("workspace:search.pageTitle")}
        headerActions={
          <Link to="/dashboard/workspace/$workspaceId" params={{ workspaceId }}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t("workspace:search.backToDashboard")}
            </Button>
          </Link>
        }
      >
        <WorkspaceSearch
          workspaceId={workspaceId}
          search={search}
          onSearchChange={(next) =>
            void navigate({ search: next, replace: true })
          }
        />
      </WorkspaceLayout>
    </>
  );
}
