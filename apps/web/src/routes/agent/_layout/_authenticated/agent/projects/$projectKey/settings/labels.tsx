import { createFileRoute } from "@tanstack/react-router";
import { ProjectSettingsRedirect } from "@/components/agent/kaneo-redirects";
import { parseLabelCatalogueSearch } from "@/lib/routes";

// Extend Kaneo's existing project settings shell with the real project catalogue.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/labels",
)({
  validateSearch: parseLabelCatalogueSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  const search = Route.useSearch();
  return (
    <ProjectSettingsRedirect
      projectKey={projectKey}
      section="labels"
      search={search}
    />
  );
}
