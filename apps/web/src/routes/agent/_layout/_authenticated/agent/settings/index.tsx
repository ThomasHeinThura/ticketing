import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacySettingsRedirectHref } from "@/lib/legacy-settings-redirect";

// The old settings home opens workspace settings (L-03); search params are kept.
export const Route = createFileRoute("/_layout/_authenticated/agent/settings/")(
  {
    beforeLoad: ({ location }) => {
      throw redirect({
        href: legacySettingsRedirectHref(location.href),
        replace: true,
      });
    },
  },
);
