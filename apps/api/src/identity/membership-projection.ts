import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";

type IdentityTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class IdentityGrantClosureChangedError extends Error {
  constructor() {
    super("IP-22 closure changed while locking; retry from a fresh snapshot");
  }
}

export async function retryIdentityGrantClosure<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      const retryableDatabaseConflict =
        code === "40P01" ||
        code === "40001" ||
        code === "23503" ||
        code === "23505";
      if (
        (!(error instanceof IdentityGrantClosureChangedError) &&
          !retryableDatabaseConflict) ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new IdentityGrantClosureChangedError();
}

export type MembershipProjectionKey = {
  personId: string;
  scope: string;
  scopeId: string;
};

/**
 * Lock the existing SCIM grant closure in the IP-22 parent-first order before the
 * caller locks the connection/configuration rows. SCIM writers share the connection
 * anchor; a closure that expands after the connection is locked must restart.
 */
export async function lockScimGrantClosure(
  tx: IdentityTransaction,
  input: {
    connectionId: string;
    actorPersonId?: string;
    proposedRoleId?: string;
    proposedScope?: string;
    proposedScopeId?: string;
    mappingId?: string;
  },
) {
  const discovered = await tx
    .select({
      id: schema.membershipGrantTable.id,
      personId: schema.membershipGrantTable.personId,
      scope: schema.membershipGrantTable.scope,
      scopeId: schema.membershipGrantTable.scopeId,
      roleId: schema.membershipGrantTable.roleId,
      identityConnectionId: schema.membershipGrantTable.identityConnectionId,
      sourceKind: schema.membershipGrantTable.sourceKind,
      externalIdentityId: schema.membershipGrantTable.externalIdentityId,
      oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
      scimGroupMappingId: schema.membershipGrantTable.scimGroupMappingId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(
          schema.membershipGrantTable.identityConnectionId,
          input.connectionId,
        ),
        eq(schema.membershipGrantTable.sourceKind, "scim_group"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const projectionKeys = [
    ...new Map(
      discovered.map((grant) => [
        `${grant.personId}\0${grant.scope}\0${grant.scopeId}`,
        {
          personId: grant.personId,
          scope: grant.scope,
          scopeId: grant.scopeId,
        },
      ]),
    ).values(),
  ];
  const projectionPredicates = projectionKeys.map((key) =>
    and(
      eq(schema.membershipGrantTable.personId, key.personId),
      eq(schema.membershipGrantTable.scope, key.scope),
      eq(schema.membershipGrantTable.scopeId, key.scopeId),
      isNull(schema.membershipGrantTable.revokedAt),
    ),
  );
  const projectionGrants = projectionPredicates.length
    ? await tx
        .select({
          id: schema.membershipGrantTable.id,
          personId: schema.membershipGrantTable.personId,
          scope: schema.membershipGrantTable.scope,
          scopeId: schema.membershipGrantTable.scopeId,
          roleId: schema.membershipGrantTable.roleId,
          identityConnectionId:
            schema.membershipGrantTable.identityConnectionId,
          sourceKind: schema.membershipGrantTable.sourceKind,
          externalIdentityId: schema.membershipGrantTable.externalIdentityId,
          oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
          scimGroupMappingId: schema.membershipGrantTable.scimGroupMappingId,
        })
        .from(schema.membershipGrantTable)
        .where(or(...projectionPredicates))
    : [];
  const sourceConnectionIds = [
    ...new Set([
      input.connectionId,
      ...projectionGrants.flatMap((grant) =>
        grant.identityConnectionId ? [grant.identityConnectionId] : [],
      ),
    ]),
  ].sort();
  const connections = await tx
    .select({ organisationId: schema.identityConnectionTable.organisationId })
    .from(schema.identityConnectionTable)
    .where(inArray(schema.identityConnectionTable.id, sourceConnectionIds));
  const mappings = await tx
    .select({
      id: schema.scimGroupMappingTable.id,
      roleId: schema.scimGroupMappingTable.roleId,
      scope: schema.scimGroupMappingTable.scope,
      scopeId: schema.scimGroupMappingTable.scopeId,
    })
    .from(schema.scimGroupMappingTable)
    .where(
      eq(schema.scimGroupMappingTable.scimConnectionId, input.connectionId),
    );
  const proposedScope =
    input.proposedScope ??
    mappings.find((mapping) => mapping.id === input.mappingId)?.scope;
  const personIds = [
    ...new Set([
      ...discovered.map((grant) => grant.personId),
      ...(input.actorPersonId ? [input.actorPersonId] : []),
    ]),
  ].sort();
  const people = personIds.length
    ? await tx
        .select({
          id: schema.personTable.id,
          organisationId: schema.personTable.organisationId,
        })
        .from(schema.personTable)
        .where(inArray(schema.personTable.id, personIds))
    : [];
  const organisationIds = [
    ...new Set([
      ...people.map((person) => person.organisationId),
      ...connections.flatMap((row) =>
        row.organisationId ? [row.organisationId] : [],
      ),
      ...(proposedScope === "organisation" && input.proposedScopeId
        ? [input.proposedScopeId]
        : []),
      ...mappings
        .filter((mapping) => mapping.scope === "organisation")
        .map((mapping) => mapping.scopeId),
    ]),
  ].sort();
  if (organisationIds.length) {
    await tx
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(inArray(schema.organisationTable.id, organisationIds))
      .orderBy(schema.organisationTable.id)
      .for("update");
  }
  const workspaceIds = [
    ...new Set([
      ...projectionGrants
        .filter((grant) => grant.scope === "workspace")
        .map((grant) => grant.scopeId),
      ...mappings
        .filter((mapping) => mapping.scope === "workspace")
        .map((mapping) => mapping.scopeId),
      ...(proposedScope === "workspace" && input.proposedScopeId
        ? [input.proposedScopeId]
        : []),
    ]),
  ].sort();
  if (workspaceIds.length) {
    await tx
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(inArray(schema.workspaceTable.id, workspaceIds))
      .orderBy(schema.workspaceTable.id)
      .for("update");
  }
  if (personIds.length) {
    await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(inArray(schema.personTable.id, personIds))
      .orderBy(schema.personTable.id)
      .for("update");
  }
  const roleIds = [
    ...new Set([
      ...projectionGrants.map((grant) => grant.roleId),
      ...mappings.map((mapping) => mapping.roleId),
      ...(input.proposedRoleId ? [input.proposedRoleId] : []),
    ]),
  ].sort();
  if (roleIds.length) {
    await tx
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(inArray(schema.roleTable.id, roleIds))
      .orderBy(schema.roleTable.id)
      .for("update");
  }
  await tx
    .select({ id: schema.identityConnectionTable.id })
    .from(schema.identityConnectionTable)
    .where(inArray(schema.identityConnectionTable.id, sourceConnectionIds))
    .orderBy(schema.identityConnectionTable.id)
    .for("update");
  const oidcMappingIds = [
    ...new Set(
      projectionGrants.flatMap((grant) =>
        grant.oidcGroupMappingId ? [grant.oidcGroupMappingId] : [],
      ),
    ),
  ].sort();
  if (oidcMappingIds.length) {
    await tx
      .select({ id: schema.oidcGroupMappingTable.id })
      .from(schema.oidcGroupMappingTable)
      .where(inArray(schema.oidcGroupMappingTable.id, oidcMappingIds))
      .orderBy(schema.oidcGroupMappingTable.id)
      .for("update");
  }
  const scimMappingIds = [
    ...new Set([
      ...mappings.map((mapping) => mapping.id),
      ...projectionGrants.flatMap((grant) =>
        grant.scimGroupMappingId ? [grant.scimGroupMappingId] : [],
      ),
    ]),
  ].sort();
  if (scimMappingIds.length) {
    await tx
      .select({ id: schema.scimGroupMappingTable.id })
      .from(schema.scimGroupMappingTable)
      .where(inArray(schema.scimGroupMappingTable.id, scimMappingIds))
      .orderBy(schema.scimGroupMappingTable.id)
      .for("update");
  }
  await tx
    .select({ id: schema.scimConnectionTable.identityConnectionId })
    .from(schema.scimConnectionTable)
    .where(
      inArray(
        schema.scimConnectionTable.identityConnectionId,
        sourceConnectionIds,
      ),
    )
    .orderBy(schema.scimConnectionTable.identityConnectionId)
    .for("update");
  const currentMappings = await tx
    .select({
      id: schema.scimGroupMappingTable.id,
      roleId: schema.scimGroupMappingTable.roleId,
      scope: schema.scimGroupMappingTable.scope,
      scopeId: schema.scimGroupMappingTable.scopeId,
    })
    .from(schema.scimGroupMappingTable)
    .where(
      eq(schema.scimGroupMappingTable.scimConnectionId, input.connectionId),
    )
    .orderBy(schema.scimGroupMappingTable.id);
  const mappingKey = (mapping: (typeof mappings)[number]) =>
    [mapping.id, mapping.roleId, mapping.scope, mapping.scopeId].join("\0");
  const discoveredMappingKeys = mappings.map(mappingKey).sort();
  const currentMappingKeys = currentMappings.map(mappingKey).sort();
  if (
    discoveredMappingKeys.length !== currentMappingKeys.length ||
    currentMappingKeys.some(
      (key, index) => key !== discoveredMappingKeys[index],
    )
  ) {
    throw new IdentityGrantClosureChangedError();
  }
  const identityIds = [
    ...new Set(
      projectionGrants.flatMap((grant) =>
        grant.externalIdentityId ? [grant.externalIdentityId] : [],
      ),
    ),
  ].sort();
  if (identityIds.length) {
    await tx
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(inArray(schema.externalIdentityTable.id, identityIds))
      .orderBy(schema.externalIdentityTable.id)
      .for("update");
  }
  const membershipPredicates = projectionKeys.map((key) =>
    and(
      eq(schema.membershipTable.personId, key.personId),
      eq(schema.membershipTable.scope, key.scope),
      eq(schema.membershipTable.scopeId, key.scopeId),
    ),
  );
  if (membershipPredicates.length) {
    for (const grant of [...discovered].sort((left, right) =>
      `${left.personId}\0${left.scope}\0${left.scopeId}`.localeCompare(
        `${right.personId}\0${right.scope}\0${right.scopeId}`,
      ),
    )) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`taskdesk:membership:${grant.personId}:${grant.scope}:${grant.scopeId}`}, 0))`);
    }
    await tx
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(or(...membershipPredicates))
      .orderBy(schema.membershipTable.id)
      .for("update");
  }
  const allProjectionGrants = projectionPredicates.length
    ? await tx
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable)
        .where(or(...projectionPredicates))
        .orderBy(schema.membershipGrantTable.id)
        .for("update")
    : [];
  const grantIds = allProjectionGrants.map((grant) => grant.id).sort();
  if (grantIds.length) {
    await tx
      .select({ id: schema.scimGroupMemberTable.id })
      .from(schema.scimGroupMemberTable)
      .where(inArray(schema.scimGroupMemberTable.membershipGrantId, grantIds))
      .orderBy(schema.scimGroupMemberTable.id)
      .for("update");
  }
  const current = await tx
    .select({
      id: schema.membershipGrantTable.id,
      personId: schema.membershipGrantTable.personId,
      scope: schema.membershipGrantTable.scope,
      scopeId: schema.membershipGrantTable.scopeId,
      roleId: schema.membershipGrantTable.roleId,
      identityConnectionId: schema.membershipGrantTable.identityConnectionId,
      sourceKind: schema.membershipGrantTable.sourceKind,
      externalIdentityId: schema.membershipGrantTable.externalIdentityId,
      oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
      scimGroupMappingId: schema.membershipGrantTable.scimGroupMappingId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(
          schema.membershipGrantTable.identityConnectionId,
          input.connectionId,
        ),
        eq(schema.membershipGrantTable.sourceKind, "scim_group"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const closureKey = (grant: (typeof discovered)[number]) =>
    [
      grant.id,
      grant.personId,
      grant.scope,
      grant.scopeId,
      grant.roleId,
      grant.externalIdentityId,
      grant.scimGroupMappingId,
    ].join("\0");
  const discoveredKeys = discovered.map(closureKey).sort();
  const currentKeys = current.map(closureKey).sort();
  if (
    currentKeys.length !== discoveredKeys.length ||
    currentKeys.some((key, index) => key !== discoveredKeys[index])
  ) {
    throw new IdentityGrantClosureChangedError();
  }
  return discovered.map(
    ({
      id: _id,
      roleId: _roleId,
      externalIdentityId: _identityId,
      scimGroupMappingId: _mappingId,
      ...key
    }) => key,
  );
}

/**
 * Recompute the one-role effective membership from the current active provenance rows.
 * Callers must acquire the IP-22 parent/person/role/source locks before invoking this
 * function and must include every source key whose validity changed in the transaction.
 */
export async function projectMembershipKeys(
  tx: IdentityTransaction,
  keys: readonly MembershipProjectionKey[],
) {
  const uniqueKeys = new Map(
    keys.map((key) => [`${key.personId}\0${key.scope}\0${key.scopeId}`, key]),
  );
  for (const key of uniqueKeys.values()) {
    const grants = await tx
      .select({
        id: schema.membershipGrantTable.id,
        roleId: schema.membershipGrantTable.roleId,
        sourceKind: schema.membershipGrantTable.sourceKind,
        seesAll: schema.membershipGrantTable.seesAll,
        roleRank: schema.roleTable.rank,
      })
      .from(schema.membershipGrantTable)
      .innerJoin(
        schema.roleTable,
        eq(schema.roleTable.id, schema.membershipGrantTable.roleId),
      )
      .where(
        and(
          eq(schema.membershipGrantTable.personId, key.personId),
          eq(schema.membershipGrantTable.scope, key.scope),
          eq(schema.membershipGrantTable.scopeId, key.scopeId),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      )
      .for("update", { of: schema.membershipGrantTable });

    const direct = grants.filter((grant) => grant.sourceKind === "direct");
    let winner: (typeof grants)[number] | undefined;
    let conflict = false;
    if (direct.length > 1) {
      throw new Error("Active direct-grant uniqueness invariant is broken");
    }
    if (direct.length === 1) {
      winner = direct[0];
    } else if (grants.length > 0) {
      const highestRank = Math.max(...grants.map((grant) => grant.roleRank));
      const highest = grants.filter((grant) => grant.roleRank === highestRank);
      const roleIds = new Set(highest.map((grant) => grant.roleId));
      if (roleIds.size > 1) {
        conflict = true;
      } else {
        const preference = { scim_group: 3, oidc_group: 2, jit_default: 1 };
        winner = [...highest].sort(
          (left, right) =>
            (preference[right.sourceKind as keyof typeof preference] ?? 0) -
            (preference[left.sourceKind as keyof typeof preference] ?? 0),
        )[0];
      }
    }

    const [existing] = await tx
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, key.personId),
          eq(schema.membershipTable.scope, key.scope),
          eq(schema.membershipTable.scopeId, key.scopeId),
        ),
      )
      .for("update")
      .limit(1);

    if (!winner || conflict) {
      if (existing) {
        await tx
          .update(schema.scimGroupMemberTable)
          .set({ membershipId: null })
          .where(eq(schema.scimGroupMemberTable.membershipId, existing.id));
        await tx
          .update(schema.membershipGrantTable)
          .set({ membershipId: null })
          .where(eq(schema.membershipGrantTable.membershipId, existing.id));
        await tx
          .delete(schema.membershipTable)
          .where(eq(schema.membershipTable.id, existing.id));
      }
      continue;
    }

    const membershipId = existing?.id ?? createId();
    if (existing) {
      await tx
        .update(schema.scimGroupMemberTable)
        .set({ membershipId: null })
        .where(eq(schema.scimGroupMemberTable.membershipId, existing.id));
      await tx
        .update(schema.membershipTable)
        .set({
          roleId: winner.roleId,
          seesAll: winner.seesAll,
          updatedAt: new Date(),
        })
        .where(eq(schema.membershipTable.id, existing.id));
    } else {
      await tx.insert(schema.membershipTable).values({
        id: membershipId,
        personId: key.personId,
        scope: key.scope,
        scopeId: key.scopeId,
        roleId: winner.roleId,
        seesAll: winner.seesAll,
      });
    }

    await tx
      .update(schema.membershipGrantTable)
      .set({ membershipId: null })
      .where(
        and(
          eq(schema.membershipGrantTable.personId, key.personId),
          eq(schema.membershipGrantTable.scope, key.scope),
          eq(schema.membershipGrantTable.scopeId, key.scopeId),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    await tx
      .update(schema.membershipGrantTable)
      .set({ membershipId })
      .where(eq(schema.membershipGrantTable.id, winner.id));
    await tx
      .update(schema.scimGroupMemberTable)
      .set({ membershipId })
      .where(eq(schema.scimGroupMemberTable.membershipGrantId, winner.id));
  }
}

export async function retireScimGroupGrants(
  tx: IdentityTransaction,
  input: {
    mappingIds?: readonly string[];
    connectionId?: string;
    reason: "mapping_changed" | "mapping_disabled" | "connection_disabled";
  },
) {
  if (!input.mappingIds?.length && !input.connectionId) return [];
  const active = await tx
    .select({
      id: schema.membershipGrantTable.id,
      personId: schema.membershipGrantTable.personId,
      scope: schema.membershipGrantTable.scope,
      scopeId: schema.membershipGrantTable.scopeId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.sourceKind, "scim_group"),
        isNull(schema.membershipGrantTable.revokedAt),
        input.mappingIds?.length
          ? inArray(schema.membershipGrantTable.scimGroupMappingId, [
              ...input.mappingIds,
            ])
          : eq(
              schema.membershipGrantTable.identityConnectionId,
              input.connectionId as string,
            ),
      ),
    )
    .for("update");
  if (!active.length) return [];
  const ids = active.map((grant) => grant.id);
  const now = new Date();
  await tx
    .update(schema.membershipGrantTable)
    .set({
      revokedAt: now,
      revocationReason: input.reason,
      updatedAt: now,
      membershipId: null,
    })
    .where(inArray(schema.membershipGrantTable.id, ids));
  await tx
    .update(schema.scimGroupMemberTable)
    .set({ revokedAt: now, membershipId: null })
    .where(inArray(schema.scimGroupMemberTable.membershipGrantId, ids));
  await projectMembershipKeys(tx, active);
  return active;
}
