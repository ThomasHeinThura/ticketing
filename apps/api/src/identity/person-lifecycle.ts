import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";
import {
  IdentityGrantClosureChangedError,
  projectMembershipKeys,
} from "./membership-projection";

/** Server-selected caller context; callers cannot choose persisted reason strings. */
export type PersonLifecycleCaller =
  | { kind: "scim"; identityId: string; connectionId: string }
  | { kind: "administrative" };

/**
 * Apply the person-wide IP-15/IP-16 transition under the caller's transaction.
 * Source-specific identity state and events remain the caller's responsibility.
 */
export async function transitionPersonLifecycleInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  personId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
  caller: PersonLifecycleCaller,
) {
  const [person] = await tx
    .select({
      id: schema.personTable.id,
      userId: schema.personTable.userId,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .limit(1);
  if (!person) return false;

  const discovered = await tx
    .select({
      id: schema.membershipGrantTable.id,
      personId: schema.membershipGrantTable.personId,
      scope: schema.membershipGrantTable.scope,
      scopeId: schema.membershipGrantTable.scopeId,
      roleId: schema.membershipGrantTable.roleId,
      sourceKind: schema.membershipGrantTable.sourceKind,
      identityConnectionId: schema.membershipGrantTable.identityConnectionId,
      externalIdentityId: schema.membershipGrantTable.externalIdentityId,
      oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
      scimGroupMappingId: schema.membershipGrantTable.scimGroupMappingId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, person.id),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const keys = discovered.map(({ personId, scope, scopeId }) => ({
    personId,
    scope,
    scopeId,
  }));
  const organisationIds = new Set([person.organisationId]);
  const workspaceIds = new Set<string>();
  for (const grant of discovered) {
    if (grant.scope === "organisation") organisationIds.add(grant.scopeId);
    if (grant.scope === "workspace") workspaceIds.add(grant.scopeId);
  }
  if (organisationIds.size)
    await tx
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(inArray(schema.organisationTable.id, [...organisationIds].sort()))
      .orderBy(schema.organisationTable.id)
      .for("update");
  if (workspaceIds.size)
    await tx
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(inArray(schema.workspaceTable.id, [...workspaceIds].sort()))
      .orderBy(schema.workspaceTable.id)
      .for("update");
  await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, person.id))
    .for("update");
  const roleIds = [...new Set(discovered.map((grant) => grant.roleId))].sort();
  if (roleIds.length)
    await tx
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(inArray(schema.roleTable.id, roleIds))
      .orderBy(schema.roleTable.id)
      .for("update");
  const connectionIds = [
    ...new Set([
      ...(caller.kind === "scim" ? [caller.connectionId] : []),
      ...discovered.flatMap((grant) =>
        grant.identityConnectionId ? [grant.identityConnectionId] : [],
      ),
    ]),
  ].sort();
  if (connectionIds.length)
    await tx
      .select({ id: schema.identityConnectionTable.id })
      .from(schema.identityConnectionTable)
      .where(inArray(schema.identityConnectionTable.id, connectionIds))
      .orderBy(schema.identityConnectionTable.id)
      .for("update");
  const oidcMappingIds = [
    ...new Set(
      discovered.flatMap((grant) =>
        grant.oidcGroupMappingId ? [grant.oidcGroupMappingId] : [],
      ),
    ),
  ].sort();
  if (oidcMappingIds.length)
    await tx
      .select({ id: schema.oidcGroupMappingTable.id })
      .from(schema.oidcGroupMappingTable)
      .where(inArray(schema.oidcGroupMappingTable.id, oidcMappingIds))
      .orderBy(schema.oidcGroupMappingTable.id)
      .for("update");
  const scimMappingIds = [
    ...new Set(
      discovered.flatMap((grant) =>
        grant.scimGroupMappingId ? [grant.scimGroupMappingId] : [],
      ),
    ),
  ].sort();
  if (scimMappingIds.length)
    await tx
      .select({ id: schema.scimGroupMappingTable.id })
      .from(schema.scimGroupMappingTable)
      .where(inArray(schema.scimGroupMappingTable.id, scimMappingIds))
      .orderBy(schema.scimGroupMappingTable.id)
      .for("update");
  if (connectionIds.length)
    await tx
      .select({
        identityConnectionId: schema.scimConnectionTable.identityConnectionId,
      })
      .from(schema.scimConnectionTable)
      .where(
        inArray(schema.scimConnectionTable.identityConnectionId, connectionIds),
      )
      .orderBy(schema.scimConnectionTable.identityConnectionId)
      .for("update");
  const identityIds = [
    ...new Set([
      ...(caller.kind === "scim" ? [caller.identityId] : []),
      ...discovered.flatMap((grant) =>
        grant.externalIdentityId ? [grant.externalIdentityId] : [],
      ),
    ]),
  ].sort();
  await tx
    .select({ id: schema.externalIdentityTable.id })
    .from(schema.externalIdentityTable)
    .where(inArray(schema.externalIdentityTable.id, identityIds))
    .orderBy(schema.externalIdentityTable.id)
    .for("update");
  for (const key of [
    ...new Map(
      keys.map((entry) => [
        `${entry.personId}\0${entry.scope}\0${entry.scopeId}`,
        entry,
      ]),
    ).values(),
  ].sort((a, b) =>
    `${a.personId}\0${a.scope}\0${a.scopeId}`.localeCompare(
      `${b.personId}\0${b.scope}\0${b.scopeId}`,
    ),
  )) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`taskdesk:membership:${key.personId}:${key.scope}:${key.scopeId}`}, 0))`,
    );
  }
  const projectionPredicates = keys.map((key) =>
    and(
      eq(schema.membershipTable.personId, key.personId),
      eq(schema.membershipTable.scope, key.scope),
      eq(schema.membershipTable.scopeId, key.scopeId),
    ),
  );
  if (projectionPredicates.length)
    await tx
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(or(...projectionPredicates))
      .orderBy(schema.membershipTable.id)
      .for("update");
  if (caller.kind === "scim") {
    const [sourceIdentity] = await tx
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(
        and(
          eq(schema.externalIdentityTable.id, caller.identityId),
          eq(
            schema.externalIdentityTable.identityConnectionId,
            caller.connectionId,
          ),
          eq(schema.externalIdentityTable.provisionedVia, "scim"),
          eq(schema.externalIdentityTable.personId, person.id),
        ),
      )
      .limit(1);
    if (!sourceIdentity) return false;
  }
  const grants = discovered.map((grant) => grant.id).sort();
  if (grants.length)
    await tx
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(inArray(schema.membershipGrantTable.id, grants))
      .orderBy(schema.membershipGrantTable.id)
      .for("update");
  const current = await tx
    .select({ id: schema.membershipGrantTable.id })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, person.id),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const currentIds = current.map((grant) => grant.id).sort();
  if (
    currentIds.length !== grants.length ||
    currentIds.some((id, index) => id !== grants[index])
  )
    throw new IdentityGrantClosureChangedError();

  const now = new Date();
  let sessionsRevoked = 0;
  let keysRevoked = 0;
  let membershipsEnded = 0;
  const externalIdentityIds = [
    ...new Set(
      discovered.flatMap((grant) =>
        grant.externalIdentityId ? [grant.externalIdentityId] : [],
      ),
    ),
  ].sort();
  await tx
    .update(schema.personTable)
    .set({ active, updatedAt: now })
    .where(eq(schema.personTable.id, person.id));
  if (!active) {
    if (person.userId) {
      const sessions = await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, person.userId))
        .returning({ id: schema.sessionTable.id });
      sessionsRevoked = sessions.length;
      const keys = await tx
        .update(schema.apikeyTable)
        .set({ enabled: false, updatedAt: now })
        .where(
          and(
            eq(schema.apikeyTable.referenceId, person.userId),
            eq(schema.apikeyTable.enabled, true),
          ),
        )
        .returning({ id: schema.apikeyTable.id });
      keysRevoked = keys.length;
    }
    const externalIds = discovered
      .filter((grant) => grant.sourceKind !== "direct")
      .map((grant) => grant.id);
    const directIds = discovered
      .filter((grant) => grant.sourceKind === "direct")
      .map((grant) => grant.id);
    if (externalIds.length) {
      const revoked = await tx
        .update(schema.membershipGrantTable)
        .set({
          revokedAt: now,
          revocationReason:
            caller.kind === "scim" ? "scim_deactivated" : "person_deactivated",
          membershipId: null,
          updatedAt: now,
        })
        .where(inArray(schema.membershipGrantTable.id, externalIds))
        .returning({ id: schema.membershipGrantTable.id });
      membershipsEnded += revoked.length;
    }
    if (lifecyclePolicy === "end_memberships" && directIds.length) {
      const revoked = await tx
        .update(schema.membershipGrantTable)
        .set({
          revokedAt: now,
          revocationReason:
            caller.kind === "scim" ? "direct_removed" : "person_deactivated",
          membershipId: null,
          updatedAt: now,
        })
        .where(inArray(schema.membershipGrantTable.id, directIds))
        .returning({ id: schema.membershipGrantTable.id });
      membershipsEnded += revoked.length;
    }
    if (grants.length)
      await tx
        .update(schema.scimGroupMemberTable)
        .set({ revokedAt: now, membershipId: null })
        .where(inArray(schema.scimGroupMemberTable.membershipGrantId, grants));
  }
  await projectMembershipKeys(tx, keys);
  return {
    sessionsRevoked,
    keysRevoked,
    membershipsEnded,
    externalIdentityIds,
  };
}
