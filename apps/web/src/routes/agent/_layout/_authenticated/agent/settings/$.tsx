import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacySettingsRedirectHref } from "@/lib/legacy-settings-redirect";

// Every old `/agent/settings/*` link, including ones already sent in emails and notifications,
// opens the same page at its canonical `/dashboard/settings/*` URL (L-03).
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/$",
)({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: legacySettingsRedirectHref(location.href),
      replace: true,
    });
  },
});
