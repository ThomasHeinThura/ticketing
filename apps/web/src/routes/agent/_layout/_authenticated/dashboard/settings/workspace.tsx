import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { WorkspaceSettingsFrame } from "@/components/settings/workspace-settings-frame";
import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";
import type Workspace from "@/types/workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace",
)({
  beforeLoad: async ({ context }) => {
    // Settings pages live outside `/dashboard/workspace/$workspaceId`, so they
    // have no route param to identify "which workspace". They rely on the
    // session's active organization. A user who deep-links here (or refreshes)
    // before ever visiting a workspace dashboard would otherwise see an empty
    // sidebar ("WS / Roles.Undefined") and a stuck "Loading…", so pick the first
    // workspace as active so the layout has something to render.
    //
    // The parent route reports whether the session fetch succeeded. When it
    // failed we don't know the user's current active organization, so we must
    // skip the fallback — calling `setActive` would clobber whatever the user
    // already had selected. Only select the first workspace after a successful
    // session response confirms that no active organization is set.
    if (context.sessionError) return;
    const session = context.session;
    if (!session) return; // parent should have redirected unauthenticated users
    if (getActiveOrganizationId(session)) return;

    let workspaces: Workspace[] = [];
    try {
      workspaces = await getWorkspaces();
    } catch (error) {
      if (import.meta.env.DEV) console.warn("getWorkspaces failed", error);
      throw redirect({ to: "/onboarding" });
    }
    if (workspaces.length === 0) {
      throw redirect({ to: "/onboarding" });
    }

    // S8a: native replacement for authClient.organization.setActive().
    await activateWorkspace(workspaces[0].id);
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <WorkspaceSettingsFrame>
      <Outlet />
    </WorkspaceSettingsFrame>
  );
}
