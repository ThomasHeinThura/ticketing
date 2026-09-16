/**
 * `session.activeOrganizationId` is a genuine, permanent column on
 * `schema.sessionTable` (`apps/api/src/auth.ts`'s `hooks.after` backfills it
 * on sign-up/sign-in, and `create-workspace.ts` writes it on workspace
 * creation) -- it is not something the removed `organization()` /
 * `organizationClient()` plugin pair owned.
 *
 * Its TYPE, however, was only ever visible on the client because
 * `organizationClient()`'s type augmentation added it to the inferred
 * session shape. Even with the plugin mounted, the SERVER's own
 * `auth.api.getSession()` return type never carried it either -- the
 * (now-deleted, S10) `organizationPluginRoleGuard` wiring in `index.ts` read
 * it through the exact same kind of explicit narrow cast this file uses,
 * for the identical reason. Now that nothing infers it for the client
 * either (S10 unmounts `organizationClient()`), read it the same way here.
 */
export function getActiveOrganizationId(
  session: { session?: unknown } | null | undefined,
): string | null {
  const raw = session?.session as
    | { activeOrganizationId?: string | null }
    | undefined;
  return raw?.activeOrganizationId ?? null;
}
