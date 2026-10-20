import { createFileRoute, redirect } from "@tanstack/react-router";

// The real screen is kaneo's (/dashboard/settings/workspace/general); this URL sends the user there.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/danger",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/workspace/general",
      replace: true,
    });
  },
});
