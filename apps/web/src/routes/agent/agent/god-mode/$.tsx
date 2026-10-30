import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyGodModeRedirectHref } from "@/lib/god-mode-paths";

// Every old `/agent/god-mode[/*]` link opens the same page at its `/god-mode[/*]` URL (L-03).
// It sits outside `_authenticated`, unlike the `/agent/settings/*` redirect, so a signed-out
// visitor reaches the God Mode sign-in (password and MFA only) rather than the normal sign-in.
export const Route = createFileRoute("/agent/god-mode/$")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: legacyGodModeRedirectHref(location.href),
      replace: true,
    });
  },
});
