import { client } from "@taskdesk/libs";
import { authClient } from "@/lib/auth-client";

// S8a (issue #6, retrofit plan §3, S8a row): native replacement for
// authClient.organization.setActive() at all nine call sites (workspace-switcher.tsx,
// onboarding-flow.tsx, create-workspace-modal.tsx, accept.$inviteId.tsx, invitations.tsx,
// dashboard/invitations.tsx, dashboard/workspace/create.tsx, dashboard/settings/workspace.tsx,
// dashboard/index.tsx). Writes the session's `active_organization_id` column through a small
// native route (`apps/api/src/workspace/controllers/activate-workspace.ts`) rather than the
// plugin, per the retrofit ledger's recommendation -- the column itself, and the sign-in
// backfill that seeds it, are untouched (renaming it is S8b, deferred out of P0).
const activateWorkspace = async (workspaceId: string) => {
  const response = await client.workspace[":workspaceId"].activate.$post({
    param: { workspaceId },
  });

  if (!response.ok) {
    // `|| "Failed to switch workspace"` matches the fallback shape the other native
    // workspace writes use (see update-workspace.ts): an empty non-2xx body -- a
    // reverse-proxy 502/504 that never reaches Hono's own error handler, which always
    // supplies a message -- must not become a blank `new Error("")` that renders as a
    // blank toast.
    const error = await response.text();
    throw new Error(error || "Failed to switch workspace");
  }

  const result = await response.json();

  // Better-auth's organization CLIENT plugin declares `/organization/set-active*` as an
  // atomListener for `$sessionSignal` (node_modules/better-auth/dist/plugins/organization/
  // client.mjs) -- the exact signal authClient.useSession() (and everything built on it,
  // e.g. useActiveWorkspace()) is driven by. This route bypasses that plugin entirely, so
  // nothing fires the listener automatically; notify the same signal ourselves so
  // switching workspace stays reactive without a reload. `$store.notify` is core
  // better-auth (config.mjs), not an organization-plugin export, so this keeps working
  // even after the plugin itself is unmounted (S10).
  authClient.$store.notify("$sessionSignal");

  return result;
};

export default activateWorkspace;
