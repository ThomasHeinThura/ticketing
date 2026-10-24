import { createFileRoute } from "@tanstack/react-router";
import { TimeActivitiesSettings } from "@/components/time-tracking/time-activities-settings";

/** `docs/screens.md` "Workspace — time activities" (P5, `TC-2`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/time-activities",
)({
  component: TimeActivitiesRoute,
});

function TimeActivitiesRoute() {
  return <TimeActivitiesSettings />;
}
