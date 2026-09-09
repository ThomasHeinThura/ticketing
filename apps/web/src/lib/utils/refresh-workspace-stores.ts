import { authClient } from "@/lib/auth-client";

/**
 * INTERIM SHIM for retrofit S4b. **Delete it when S3 (PR #76) repoints the
 * workspace READS off the plugin** — at that point the reads own their own
 * cache and a native write invalidates that instead.
 *
 * Why it exists, because the reason is not visible from any one file:
 *
 * The workspace name the UI displays does not come from react-query. It comes
 * from better-auth's own nanostores — `use-active-workspace.ts` and
 * `use-get-workspaces.ts` read `authClient.useActiveOrganization()` and
 * `authClient.useListOrganizations()`. Those stores are refreshed by the
 * organization plugin's `atomListeners`, and those listeners match on **plugin
 * route paths**: `/organization/update` notifies `$listOrg` and
 * `$activeOrgSignal` (`better-auth/dist/plugins/organization/client.mjs`).
 *
 * S4b repoints the WRITES onto `/api/workspace/*`. No plugin path is hit any
 * more, so neither store is ever told, and the displayed name goes stale until
 * a full reload. Reproduced in a browser before this shim existed: after a
 * successful `PATCH /api/workspace/{id}` the settings sidebar **and** the
 * delete-confirmation dialog both still named the workspace by its previous
 * name, while the database already held the new one.
 *
 * `general.tsx` does call
 * `queryClient.invalidateQueries({ queryKey: ["active-organization"] })`, and
 * that is not the fix: nothing subscribes to that key. It is invalidated in
 * three places and read in none.
 *
 * Create and delete happened to survive the cutover by accident — create calls
 * `organization/set-active` immediately afterwards and delete redirects away —
 * so they are wired up here too, to be correct by construction rather than by
 * side effect.
 *
 * This deliberately uses the plugin's own escape hatch rather than introducing
 * a second cache. `$store.notify` flips the atom, which re-runs
 * `/organization/list` and `/organization/get-full-organization` — still the
 * source of truth for workspace reads until S3 lands.
 */
export function refreshWorkspaceStores(): void {
  // Signal names are the atom keys the organization client returns from
  // `getAtoms`. `$store.notify` indexes `pluginsAtoms[signal]` directly, so a
  // typo here throws at runtime rather than failing quietly.
  authClient.$store.notify("$listOrg");
  authClient.$store.notify("$activeOrgSignal");
}
