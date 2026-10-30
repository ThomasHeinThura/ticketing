import { createFileRoute, redirect } from "@tanstack/react-router";
import { routes } from "@/lib/routes";

// The bare account settings URL opens the first account page.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/",
)({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: routes.accountInformation.path,
      search,
      replace: true,
    });
  },
});
