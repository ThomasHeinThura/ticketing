import { createFileRoute } from "@tanstack/react-router";
import { LabelCatalogue } from "@/components/settings/label-catalogue";
import { parseLabelCatalogueSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/labels",
)({
  validateSearch: parseLabelCatalogueSearch,
  component: RouteComponent,
});
function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <LabelCatalogue
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  );
}
