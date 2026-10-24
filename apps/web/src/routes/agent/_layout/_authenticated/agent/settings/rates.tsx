import { createFileRoute } from "@tanstack/react-router";
import { RatesSettings } from "@/components/time-tracking/rates-settings";

/** `docs/screens.md` "Workspace — rates" (P5, `TC-8`..`TC-11`). */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/rates",
)({
  component: RatesRoute,
});

function RatesRoute() {
  return <RatesSettings />;
}
