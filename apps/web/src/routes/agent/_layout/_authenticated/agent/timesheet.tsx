import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Timesheet } from "@/components/time-tracking/timesheet";
import { parseTimesheetSearch } from "@/lib/routes";

/** `docs/screens.md` "Timesheet" (P5, `TC-*`): the week grid; week and scope live in the URL. */
export const Route = createFileRoute("/_layout/_authenticated/agent/timesheet")(
  {
    validateSearch: parseTimesheetSearch,
    component: TimesheetRoute,
  },
);

function TimesheetRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <Timesheet
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
