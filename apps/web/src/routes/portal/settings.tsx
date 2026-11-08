import { createFileRoute, redirect } from "@tanstack/react-router";

// UX-8 (CP-12): the sidebar calls the account page "Settings", so customers type `/settings`;
// it opens the host-root `/account` route, keeping the query.
export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/account${location.searchStr ?? ""}`,
      replace: true,
    });
  },
});
