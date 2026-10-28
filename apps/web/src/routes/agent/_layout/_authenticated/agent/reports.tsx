import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ReportsIndex } from "@/components/reports/reports-index";
import { parseReportsIndexSearch } from "@/lib/report-search";

/** `docs/screens.md` "Reports index" (P5, `RP-*`): category chips live in the URL. */
export const Route = createFileRoute("/_layout/_authenticated/agent/reports")({
  validateSearch: parseReportsIndexSearch,
  component: ReportsIndexRoute,
});

function ReportsIndexRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ReportsIndex
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
