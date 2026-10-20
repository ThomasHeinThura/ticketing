import { createFileRoute, redirect } from "@tanstack/react-router";

// `/portal/sign-in` is a link customers already have; the sign-in screen lives at the host
// root (`/sign-in`). The query string (`?redirect=…`) is kept.
export const Route = createFileRoute("/portal/sign-in")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/sign-in${location.searchStr ?? ""}` });
  },
});
