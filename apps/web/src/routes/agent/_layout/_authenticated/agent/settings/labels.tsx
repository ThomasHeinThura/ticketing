import { createFileRoute, redirect } from "@tanstack/react-router";

// The real screen is kaneo's (/dashboard/settings/workspace/labels); this URL sends the user there.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/labels",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/workspace/labels",
      replace: true,
    });
  },
});
