import { createFileRoute, redirect } from "@tanstack/react-router";
import { routes } from "@/lib/routes";

// The bare settings URL has no page of its own; it opens the person's account settings.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/",
)({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: routes.accountInformation.path,
      search,
      replace: true,
    });
  },
});
