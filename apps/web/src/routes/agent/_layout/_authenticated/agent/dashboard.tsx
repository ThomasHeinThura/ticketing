import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DashboardView } from "@/components/reports/dashboard-view";
import { parseDashboardSearch } from "@/lib/report-search";

/** `docs/screens.md` "Dashboard" (P5, `RP-13`): which dashboard is in the URL. */
export const Route = createFileRoute("/_layout/_authenticated/agent/dashboard")(
  {
    validateSearch: parseDashboardSearch,
    component: DashboardRoute,
  },
);

function DashboardRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DashboardView
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
