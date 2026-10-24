import { createFileRoute } from "@tanstack/react-router";
import { DashboardEditor } from "@/components/reports/dashboard-editor";
import { parseDashboardSearch } from "@/lib/report-search";

/** `docs/screens.md` "Dashboard editor" (P5, `RP-15`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/dashboard_/edit",
)({
  validateSearch: parseDashboardSearch,
  component: DashboardEditorRoute,
});

function DashboardEditorRoute() {
  return <DashboardEditor search={Route.useSearch()} />;
}
