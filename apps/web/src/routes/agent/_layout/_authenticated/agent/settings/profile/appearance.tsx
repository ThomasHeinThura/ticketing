import { createFileRoute, redirect } from "@tanstack/react-router";

// The real screen is kaneo's (/dashboard/settings/account/preferences); this URL sends the user there.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/appearance",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/account/preferences",
      replace: true,
    });
  },
});
