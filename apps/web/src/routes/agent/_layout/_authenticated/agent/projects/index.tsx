import { createFileRoute, redirect } from "@tanstack/react-router";

// UX-8: the projects list lives at `/agent` (the sidebar's Projects link); the bare
// `/agent/projects` URL people type or bookmark opens it, keeping the query.
export const Route = createFileRoute("/_layout/_authenticated/agent/projects/")(
  {
    beforeLoad: ({ search }) => {
      throw redirect({ to: "/agent", search, replace: true });
    },
  },
);
