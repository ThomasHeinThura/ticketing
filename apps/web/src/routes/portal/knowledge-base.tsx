import { createFileRoute, redirect } from "@tanstack/react-router";

// UX-8 (CP-12): `/knowledge-base` opens the host-root `/kb` route, keeping the query.
export const Route = createFileRoute("/knowledge-base")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/kb${location.searchStr ?? ""}`,
      replace: true,
    });
  },
});
