import { createFileRoute, redirect } from "@tanstack/react-router";

// The bare workspace settings URL opens the first workspace page.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/",
)({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/dashboard/settings/workspace/general",
      search,
      replace: true,
    });
  },
});
