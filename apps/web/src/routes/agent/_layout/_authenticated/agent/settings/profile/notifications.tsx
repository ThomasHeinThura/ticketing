import { createFileRoute, redirect } from "@tanstack/react-router";

// The entry bootstrap exchanges the signed fragment before authentication. The
// HttpOnly handoff cookie then survives this alias to Kaneo's actual editor.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/notifications",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/account/notifications",
      replace: true,
    });
  },
});
