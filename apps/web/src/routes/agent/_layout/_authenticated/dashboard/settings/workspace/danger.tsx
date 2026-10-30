import { createFileRoute, redirect } from "@tanstack/react-router";

// The danger zone (workspace deletion) is part of General today; this URL sends the user there.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/danger",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/workspace/general",
      replace: true,
    });
  },
});
