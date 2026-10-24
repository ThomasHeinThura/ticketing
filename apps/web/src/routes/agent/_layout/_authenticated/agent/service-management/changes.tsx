import { createFileRoute } from "@tanstack/react-router";
import { ChangeCalendarView } from "@/components/service-management/change-calendar";
import { parseChangeCalendarSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/service-management/changes",
)({
  validateSearch: parseChangeCalendarSearch,
  component: ChangesRoute,
});

function ChangesRoute() {
  const search = Route.useSearch();
  return <ChangeCalendarView search={search} />;
}
