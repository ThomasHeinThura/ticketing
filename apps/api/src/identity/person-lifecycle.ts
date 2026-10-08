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

/** Rows read during a parent-first IP-22 closure acquisition. */
export type PersonLifecycleClosure = {
  people: Array<{
    id: string;
    userId: string | null;
    organisationId: string | null;
    active: boolean;
  }>;
  grants: Array<{
    id: string;
    personId: string;
    scope: string;
    scopeId: string;
    roleId: string;
    sourceKind: string;
    identityConnectionId: string | null;
    externalIdentityId: string | null;
    oidcGroupMappingId: string | null;
    scimGroupMappingId: string | null;
  }>;
};

type IdentityTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Discover and lock the complete lifecycle closure for one or more people. Reads before
 * parent locks are discovery only: both person rows and active grants are re-read after
 * all organisation/workspace anchors and person rows are locked. Any expansion restarts
 * the owning transaction from a fresh snapshot.
 */
export async function lockPersonLifecycleClosureInTransaction(
  tx: IdentityTransaction,
  personIds: readonly string[],
  caller: PersonLifecycleCaller,
): Promise<PersonLifecycleClosure> {
  const ids = [...new Set(personIds)].sort();
  if (ids.length === 0) return { people: [], grants: [] };

  const people = await tx
    .select({
      id: schema.personTable.id,
      userId: schema.personTable.userId,
      organisationId: schema.personTable.organisationId,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(inArray(schema.personTable.id, ids))
    .orderBy(schema.personTable.id);
  const foundPersonIds = people.map((person) => person.id);
  const discovered = foundPersonIds.length
    ? await tx
        .select({
          id: schema.membershipGrantTable.id,
          personId: schema.membershipGrantTable.personId,
          scope: schema.membershipGrantTable.scope,
          scopeId: schema.membershipGrantTable.scopeId,
          roleId: schema.membershipGrantTable.roleId,
          sourceKind: schema.membershipGrantTable.sourceKind,
          identityConnectionId:
            schema.membershipGrantTable.identityConnectionId,
          externalIdentityId: schema.membershipGrantTable.externalIdentityId,
          oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
          scimGroupMappingId: schema.membershipGrantTable.scimGroupMappingId,
        })
        .from(schema.membershipGrantTable)
        .where(
          and(
            inArray(schema.membershipGrantTable.personId, foundPersonIds),
            isNull(schema.membershipGrantTable.revokedAt),
          ),
        )
        .orderBy(schema.membershipGrantTable.id)
    : [];

  const keys = discovered.map(({ personId, scope, scopeId }) => ({
    personId,
    scope,
    scopeId,
  }));
  const organisationIds = new Set(
    people.flatMap((person) =>
      person.organisationId ? [person.organisationId] : [],
    ),
  );
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
    .where(inArray(schema.personTable.id, foundPersonIds))
    .orderBy(schema.personTable.id)
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
  if (identityIds.length)
    await tx
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(inArray(schema.externalIdentityTable.id, identityIds))
      .orderBy(schema.externalIdentityTable.id)
      .for("update");

  const projectionKeys = [
    ...new Map(
      keys.map((key) => [`${key.personId}\0${key.scope}\0${key.scopeId}`, key]),
    ).values(),
  ].sort((left, right) =>
    `${left.personId}\0${left.scope}\0${left.scopeId}`.localeCompare(
      `${right.personId}\0${right.scope}\0${right.scopeId}`,
    ),
  );
  for (const key of projectionKeys)
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`taskdesk:membership:${key.personId}:${key.scope}:${key.scopeId}`}, 0))`,
    );
  const membershipPredicates = projectionKeys.map((key) =>
    and(
      eq(schema.membershipTable.personId, key.personId),
      eq(schema.membershipTable.scope, key.scope),
      eq(schema.membershipTable.scopeId, key.scopeId),
    ),
  );
  if (membershipPredicates.length)
    await tx
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(or(...membershipPredicates))
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
          inArray(schema.externalIdentityTable.personId, foundPersonIds),
        ),
      )
      .limit(1);
    if (!sourceIdentity) return { people: [], grants: [] };
  }

  const discoveredIds = discovered.map((grant) => grant.id).sort();
  if (discoveredIds.length)
    await tx
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(inArray(schema.membershipGrantTable.id, discoveredIds))
      .orderBy(schema.membershipGrantTable.id)
      .for("update");
  const currentPeople = await tx
    .select({
      id: schema.personTable.id,
      userId: schema.personTable.userId,
      organisationId: schema.personTable.organisationId,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(inArray(schema.personTable.id, foundPersonIds))
    .orderBy(schema.personTable.id);
  const currentGrants = foundPersonIds.length
    ? await tx
        .select({
          id: schema.membershipGrantTable.id,
          personId: schema.membershipGrantTable.personId,
          scope: schema.membershipGrantTable.scope,
          scopeId: schema.membershipGrantTable.scopeId,
          roleId: schema.membershipGrantTable.roleId,
          sourceKind: schema.membershipGrantTable.sourceKind,
          identityConnectionId:
            schema.membershipGrantTable.identityConnectionId,
          externalIdentityId: schema.membershipGrantTable.externalIdentityId,
          oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
          scimGroupMappingId: schema.membershipGrantTable.scimGroupMappingId,
        })
        .from(schema.membershipGrantTable)
        .where(
          and(
            inArray(schema.membershipGrantTable.personId, foundPersonIds),
            isNull(schema.membershipGrantTable.revokedAt),
          ),
        )
        .orderBy(schema.membershipGrantTable.id)
    : [];
  const personKey = (person: (typeof people)[number]) =>
    [person.id, person.userId, person.organisationId, person.active].join("\0");
  const grantKey = (grant: (typeof discovered)[number]) =>
    [
      grant.id,
      grant.personId,
      grant.scope,
      grant.scopeId,
      grant.roleId,
      grant.sourceKind,
      grant.identityConnectionId,
      grant.externalIdentityId,
      grant.oidcGroupMappingId,
      grant.scimGroupMappingId,
    ].join("\0");
  if (
    currentPeople.map(personKey).join("\n") !==
      people.map(personKey).join("\n") ||
    currentGrants.map(grantKey).join("\n") !==
      discovered.map(grantKey).join("\n")
  )
    throw new IdentityGrantClosureChangedError();
  return { people, grants: discovered };
}

/**
 * Apply the person-wide IP-15/IP-16 transition under the caller's transaction.
 * Source-specific identity state and events remain the caller's responsibility.
 */
export async function transitionPersonLifecycleInTransaction(
  tx: IdentityTransaction,
  personId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
  caller: PersonLifecycleCaller,
  lockedClosure?: PersonLifecycleClosure,
) {
  const closure =
    lockedClosure ??
    (await lockPersonLifecycleClosureInTransaction(tx, [personId], caller));
  const person = closure.people.find((candidate) => candidate.id === personId);
  if (!person) return false;
  const discovered = closure.grants.filter(
    (grant) => grant.personId === personId,
  );
  const grants = discovered.map((grant) => grant.id).sort();
  const keys = discovered.map(({ personId, scope, scopeId }) => ({
    personId,
    scope,
    scopeId,
  }));
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
