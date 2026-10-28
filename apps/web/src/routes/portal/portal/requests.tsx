import { createFileRoute, redirect } from "@tanstack/react-router";

// `/portal/requests` redirects to the host-root `/requests` route.
export const Route = createFileRoute("/portal/requests")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/requests${location.searchStr ?? ""}` });
  },
});
