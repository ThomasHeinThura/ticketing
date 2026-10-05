import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import {
  IdentityGrantClosureChangedError,
  lockScimGrantClosure,
  projectMembershipKeys,
  retireScimGroupGrants,
  retryIdentityGrantClosure,
} from "./membership-projection";
import { validateScimMappingRole } from "./scim-admin";
import {
  lockAndVerifyScimMutation,
  type ScimRequestAuthority,
} from "./scim-authentication";

type GroupWrite = {
  authority: ScimRequestAuthority;
  connectionId: string;
  groupId?: string;
  createOnly?: boolean;
  externalId: string;
  displayName: string;
  active: boolean;
  memberIds: readonly string[];
};

export class ScimGroupWriteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    readonly code: "invalidValue" | "notFound" | "uniqueness" | "configuration",
  ) {
    super("SCIM group write rejected");
  }
}

/** Store directory state and apply only currently valid mapped-role grants. */
export async function writeScimGroup(input: GroupWrite) {
  return retryIdentityGrantClosure(async () =>
    db.transaction(async (tx) => {
      const [connection] = await tx
        .select({
          issuer: schema.identityConnectionTable.issuer,
          portalScope: schema.identityConnectionTable.portalScope,
          organisationId: schema.identityConnectionTable.organisationId,
          maxRoleRank: schema.identityConnectionTable.maxRoleRank,
          connectionEnabled: schema.identityConnectionTable.enabled,
          scimEnabled: schema.scimConnectionTable.enabled,
          allowedResources: schema.scimConnectionTable.allowedResources,
        })
        .from(schema.identityConnectionTable)
        .innerJoin(
          schema.scimConnectionTable,
          eq(
            schema.scimConnectionTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
        )
        .where(eq(schema.identityConnectionTable.id, input.connectionId))
        .limit(1);
      if (
        !connection?.connectionEnabled ||
        !connection.scimEnabled ||
        !connection.allowedResources.includes("groups")
      )
        throw new ScimGroupWriteError(503, "configuration");

      let [group] = await tx
        .select({
          id: schema.scimGroupTable.id,
          externalId: schema.scimGroupTable.externalId,
          displayName: schema.scimGroupTable.displayName,
          active: schema.scimGroupTable.active,
        })
        .from(schema.scimGroupTable)
        .where(
          and(
            eq(schema.scimGroupTable.scimConnectionId, input.connectionId),
            input.groupId
              ? eq(schema.scimGroupTable.id, input.groupId)
              : eq(schema.scimGroupTable.externalId, input.externalId),
          ),
        )
        .limit(1);
      if (input.groupId && !group)
        throw new ScimGroupWriteError(404, "notFound");
      if (input.createOnly && group)
        throw new ScimGroupWriteError(409, "uniqueness");
      if (group && group.externalId !== input.externalId)
        throw new ScimGroupWriteError(400, "invalidValue");
      const initiallyActiveMembers = group
        ? await tx
            .select({
              externalIdentityId:
                schema.scimGroupDirectoryMemberTable.externalIdentityId,
            })
            .from(schema.scimGroupDirectoryMemberTable)
            .where(
              and(
                eq(
                  schema.scimGroupDirectoryMemberTable.scimConnectionId,
                  input.connectionId,
                ),
                eq(schema.scimGroupDirectoryMemberTable.scimGroupId, group.id),
                eq(schema.scimGroupDirectoryMemberTable.active, true),
              ),
            )
        : [];

      const [mapping] = await tx
        .select({
          id: schema.scimGroupMappingTable.id,
          externalGroupId: schema.scimGroupMappingTable.externalGroupId,
          roleId: schema.scimGroupMappingTable.roleId,
          scope: schema.scimGroupMappingTable.scope,
          scopeId: schema.scimGroupMappingTable.scopeId,
          enabled: schema.scimGroupMappingTable.enabled,
        })
        .from(schema.scimGroupMappingTable)
        .where(
          and(
            eq(
              schema.scimGroupMappingTable.scimConnectionId,
              input.connectionId,
            ),
            eq(schema.scimGroupMappingTable.externalGroupId, input.externalId),
          ),
        )
        .limit(1);
      const [scimConnection] = await tx
        .select({ lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy })
        .from(schema.scimConnectionTable)
        .where(
          eq(
            schema.scimConnectionTable.identityConnectionId,
            input.connectionId,
          ),
        )
        .limit(1);
      if (
        !scimConnection ||
        (scimConnection.lifecyclePolicy !== "end_memberships" &&
          scimConnection.lifecyclePolicy !== "keep_memberships")
      )
        throw new ScimGroupWriteError(503, "configuration");

      const uniqueMemberIds = [...new Set(input.memberIds)].sort();
      const closureIdentityIds = [
        ...new Set([
          ...uniqueMemberIds,
          ...initiallyActiveMembers.map((member) => member.externalIdentityId),
        ]),
      ].sort();
      const identities = closureIdentityIds.length
        ? await tx
            .select({
              id: schema.externalIdentityTable.id,
              personId: schema.externalIdentityTable.personId,
              identityActive: schema.externalIdentityTable.active,
              personActive: schema.personTable.active,
              personSide: schema.personTable.side,
              personOrganisationId: schema.personTable.organisationId,
            })
            .from(schema.externalIdentityTable)
            .innerJoin(
              schema.personTable,
              eq(schema.personTable.id, schema.externalIdentityTable.personId),
            )
            .where(
              and(
                eq(
                  schema.externalIdentityTable.identityConnectionId,
                  input.connectionId,
                ),
                eq(schema.externalIdentityTable.provisionedVia, "scim"),
                inArray(schema.externalIdentityTable.id, closureIdentityIds),
              ),
            )
        : [];
      if (identities.length !== closureIdentityIds.length)
        throw new ScimGroupWriteError(400, "invalidValue");
      if (
        identities.some((identity) =>
          connection.portalScope === "agent"
            ? identity.personSide !== "staff"
            : identity.personSide !== "customer" ||
              identity.personOrganisationId !== connection.organisationId,
        )
      )
        throw new ScimGroupWriteError(400, "invalidValue");

      const activeById = new Map(
        identities.map((identity) => [
          identity.id,
          identity.identityActive && identity.personActive,
        ]),
      );
      const canMap = Boolean(mapping?.enabled);
      const additionalProjectionKeys =
        canMap && mapping
          ? identities.map((identity) => ({
              personId: identity.personId,
              externalIdentityId: identity.id,
              scope: mapping.scope,
              scopeId: mapping.scopeId,
              roleId: mapping.roleId,
            }))
          : [];
      await lockScimGrantClosure(tx, {
        connectionId: input.connectionId,
        ...(mapping
          ? {
              mappingId: mapping.id,
              proposedRoleId: mapping.roleId,
              proposedScope: mapping.scope,
              proposedScopeId: mapping.scopeId,
            }
          : {}),
        ...(group ? { scimGroupIds: [group.id] } : {}),
        additionalProjectionKeys,
      });
      await lockAndVerifyScimMutation(tx, input.authority, "groups");

      const [currentConnection] = await tx
        .select({
          issuer: schema.identityConnectionTable.issuer,
          portalScope: schema.identityConnectionTable.portalScope,
          organisationId: schema.identityConnectionTable.organisationId,
          maxRoleRank: schema.identityConnectionTable.maxRoleRank,
          connectionEnabled: schema.identityConnectionTable.enabled,
          scimEnabled: schema.scimConnectionTable.enabled,
          allowedResources: schema.scimConnectionTable.allowedResources,
        })
        .from(schema.identityConnectionTable)
        .innerJoin(
          schema.scimConnectionTable,
          eq(
            schema.scimConnectionTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
        )
        .where(eq(schema.identityConnectionTable.id, input.connectionId))
        .limit(1);
      if (
        !currentConnection ||
        currentConnection.issuer !== connection.issuer ||
        currentConnection.portalScope !== connection.portalScope ||
        currentConnection.organisationId !== connection.organisationId ||
        currentConnection.maxRoleRank !== connection.maxRoleRank ||
        currentConnection.connectionEnabled !== connection.connectionEnabled ||
        currentConnection.scimEnabled !== connection.scimEnabled ||
        JSON.stringify(currentConnection.allowedResources) !==
          JSON.stringify(connection.allowedResources)
      )
        throw new IdentityGrantClosureChangedError();
      if (group) {
        const [currentGroup] = await tx
          .select({
            externalId: schema.scimGroupTable.externalId,
            displayName: schema.scimGroupTable.displayName,
            active: schema.scimGroupTable.active,
          })
          .from(schema.scimGroupTable)
          .where(
            and(
              eq(schema.scimGroupTable.scimConnectionId, input.connectionId),
              eq(schema.scimGroupTable.id, group.id),
            ),
          )
          .limit(1);
        if (
          !currentGroup ||
          currentGroup.externalId !== group.externalId ||
          currentGroup.displayName !== group.displayName ||
          currentGroup.active !== group.active
        )
          throw new IdentityGrantClosureChangedError();
      }

      const [currentMapping] = await tx
        .select({
          id: schema.scimGroupMappingTable.id,
          externalGroupId: schema.scimGroupMappingTable.externalGroupId,
          roleId: schema.scimGroupMappingTable.roleId,
          scope: schema.scimGroupMappingTable.scope,
          scopeId: schema.scimGroupMappingTable.scopeId,
          enabled: schema.scimGroupMappingTable.enabled,
        })
        .from(schema.scimGroupMappingTable)
        .where(
          and(
            eq(
              schema.scimGroupMappingTable.scimConnectionId,
              input.connectionId,
            ),
            eq(schema.scimGroupMappingTable.externalGroupId, input.externalId),
          ),
        )
        .limit(1);
      if (
        (currentMapping?.id ?? null) !== (mapping?.id ?? null) ||
        (currentMapping?.roleId ?? null) !== (mapping?.roleId ?? null) ||
        (currentMapping?.scope ?? null) !== (mapping?.scope ?? null) ||
        (currentMapping?.scopeId ?? null) !== (mapping?.scopeId ?? null) ||
        (currentMapping?.enabled ?? null) !== (mapping?.enabled ?? null)
      )
        throw new IdentityGrantClosureChangedError();

      if (closureIdentityIds.length) {
        const currentIdentities = await tx
          .select({
            id: schema.externalIdentityTable.id,
            personId: schema.externalIdentityTable.personId,
            identityActive: schema.externalIdentityTable.active,
            personActive: schema.personTable.active,
            personSide: schema.personTable.side,
            personOrganisationId: schema.personTable.organisationId,
            provisionedVia: schema.externalIdentityTable.provisionedVia,
            connectionId: schema.externalIdentityTable.identityConnectionId,
          })
          .from(schema.externalIdentityTable)
          .innerJoin(
            schema.personTable,
            eq(schema.personTable.id, schema.externalIdentityTable.personId),
          )
          .where(inArray(schema.externalIdentityTable.id, closureIdentityIds));
        const initialById = new Map(
          identities.map((identity) => [identity.id, identity]),
        );
        if (
          currentIdentities.length !== identities.length ||
          currentIdentities.some((identity) => {
            const initial = initialById.get(identity.id);
            return (
              !initial ||
              identity.personId !== initial.personId ||
              identity.identityActive !== initial.identityActive ||
              identity.personActive !== initial.personActive ||
              identity.personSide !== initial.personSide ||
              identity.personOrganisationId !== initial.personOrganisationId ||
              identity.provisionedVia !== "scim" ||
              identity.connectionId !== input.connectionId
            );
          })
        )
          throw new IdentityGrantClosureChangedError();
      }

      if (
        currentMapping?.enabled &&
        !(await validateScimMappingRole(tx, {
          portalScope: connection.portalScope,
          organisationId: connection.organisationId,
          maxRoleRank: connection.maxRoleRank,
          scope: currentMapping.scope as "organisation" | "workspace",
          scopeId: currentMapping.scopeId,
          roleId: currentMapping.roleId,
        }))
      )
        throw new ScimGroupWriteError(503, "configuration");

      const currentActiveMembers = group
        ? await tx
            .select({
              externalIdentityId:
                schema.scimGroupDirectoryMemberTable.externalIdentityId,
            })
            .from(schema.scimGroupDirectoryMemberTable)
            .where(
              and(
                eq(
                  schema.scimGroupDirectoryMemberTable.scimConnectionId,
                  input.connectionId,
                ),
                eq(schema.scimGroupDirectoryMemberTable.scimGroupId, group.id),
                eq(schema.scimGroupDirectoryMemberTable.active, true),
              ),
            )
        : [];
      const initialIds = initiallyActiveMembers
        .map((member) => member.externalIdentityId)
        .sort();
      const currentIds = currentActiveMembers
        .map((member) => member.externalIdentityId)
        .sort();
      if (
        initialIds.length !== currentIds.length ||
        currentIds.some((identityId, index) => identityId !== initialIds[index])
      )
        throw new IdentityGrantClosureChangedError();

      const now = new Date();
      const wasCreated = !group;
      const previousDisplayName = group?.displayName;
      const previousActive = group?.active;
      if (group) {
        await tx
          .update(schema.scimGroupTable)
          .set({
            displayName: input.displayName,
            active: input.active,
            deactivatedAt: input.active ? null : now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.scimGroupTable.id, group.id),
              eq(schema.scimGroupTable.scimConnectionId, input.connectionId),
            ),
          );
      } else {
        const id = createId();
        await tx.insert(schema.scimGroupTable).values({
          id,
          scimConnectionId: input.connectionId,
          externalId: input.externalId,
          displayName: input.displayName,
          active: input.active,
          deactivatedAt: input.active ? null : now,
        });
        group = {
          id,
          externalId: input.externalId,
          displayName: input.displayName,
          active: input.active,
        };
      }

      const oldMembers = group
        ? await tx
            .select({
              id: schema.scimGroupDirectoryMemberTable.id,
              externalIdentityId:
                schema.scimGroupDirectoryMemberTable.externalIdentityId,
            })
            .from(schema.scimGroupDirectoryMemberTable)
            .where(
              and(
                eq(
                  schema.scimGroupDirectoryMemberTable.scimConnectionId,
                  input.connectionId,
                ),
                eq(schema.scimGroupDirectoryMemberTable.scimGroupId, group.id),
                eq(schema.scimGroupDirectoryMemberTable.active, true),
              ),
            )
        : [];
      const desiredIds = new Set(input.active ? uniqueMemberIds : []);
      const oldIds = new Set(
        oldMembers.map((member) => member.externalIdentityId),
      );
      const removedIds = oldMembers
        .filter((member) => !desiredIds.has(member.externalIdentityId))
        .map((member) => member.externalIdentityId);
      const addedIds = uniqueMemberIds.filter(
        (identityId) => input.active && !oldIds.has(identityId),
      );
      if (removedIds.length) {
        await tx
          .update(schema.scimGroupDirectoryMemberTable)
          .set({ active: false, removedAt: now, updatedAt: now })
          .where(
            and(
              eq(
                schema.scimGroupDirectoryMemberTable.scimConnectionId,
                input.connectionId,
              ),
              eq(schema.scimGroupDirectoryMemberTable.scimGroupId, group.id),
              inArray(
                schema.scimGroupDirectoryMemberTable.externalIdentityId,
                removedIds,
              ),
            ),
          );
        await tx.insert(schema.provisioningEventTable).values(
          removedIds.map((externalIdentityId) => ({
            identityConnectionId: input.connectionId,
            scimConnectionId: input.connectionId,
            externalIdentityId,
            kind: "group.member_removed",
            outcome: "success",
            detail: { groupId: group?.id, reason: "scim_group_removed" },
            actorType: "scim",
          })),
        );
      }
      if (addedIds.length) {
        await tx.insert(schema.scimGroupDirectoryMemberTable).values(
          addedIds.map((externalIdentityId) => ({
            scimConnectionId: input.connectionId,
            scimGroupId: group.id,
            externalIdentityId,
          })),
        );
        await tx.insert(schema.provisioningEventTable).values(
          addedIds.map((externalIdentityId) => ({
            identityConnectionId: input.connectionId,
            scimConnectionId: input.connectionId,
            externalIdentityId,
            kind: "group.member_added",
            outcome: "success",
            detail: { groupId: group?.id },
            actorType: "scim",
          })),
        );
      }

      const changedFields = [
        ...(wasCreated ? ["created"] : []),
        ...(previousDisplayName !== input.displayName ? ["displayName"] : []),
        ...(previousActive !== input.active ? ["active"] : []),
      ];
      if (changedFields.length)
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: input.connectionId,
          scimConnectionId: input.connectionId,
          kind: "group.directory_changed",
          outcome: "success",
          detail: { groupId: group.id, changedFields },
          actorType: "scim",
        });

      if (currentMapping) {
        const identitiesToRetire = [
          ...removedIds,
          ...uniqueMemberIds.filter(
            (identityId) => !activeById.get(identityId),
          ),
        ];
        if (
          !currentMapping.enabled ||
          !input.active ||
          identitiesToRetire.length
        ) {
          await retireScimGroupGrants(tx, {
            mappingIds: [currentMapping.id],
            // A disabled mapping must retire every grant that it ever created,
            // and deactivation must retire stale grants even when a prior write
            // already removed their directory-member rows.
            ...(currentMapping.enabled && input.active
              ? { externalIdentityIds: identitiesToRetire }
              : {}),
            reason: !currentMapping.enabled
              ? "mapping_disabled"
              : "scim_group_removed",
          });
        }
        if (currentMapping.enabled && input.active) {
          const grantProjectionKeys = [];
          for (const identityId of uniqueMemberIds) {
            if (!activeById.get(identityId)) continue;
            const identity = identities.find((row) => row.id === identityId);
            if (!identity) continue;
            const [existingGrant] = await tx
              .select({ id: schema.membershipGrantTable.id })
              .from(schema.membershipGrantTable)
              .where(
                and(
                  eq(schema.membershipGrantTable.sourceKind, "scim_group"),
                  eq(
                    schema.membershipGrantTable.externalIdentityId,
                    identityId,
                  ),
                  eq(
                    schema.membershipGrantTable.scimGroupMappingId,
                    currentMapping.id,
                  ),
                  isNull(schema.membershipGrantTable.revokedAt),
                ),
              )
              .limit(1);
            if (existingGrant) continue;
            const grantId = createId();
            await tx.insert(schema.membershipGrantTable).values({
              id: grantId,
              personId: identity.personId,
              scope: currentMapping.scope,
              scopeId: currentMapping.scopeId,
              roleId: currentMapping.roleId,
              sourceKind: "scim_group",
              externalIdentityId: identityId,
              identityConnectionId: input.connectionId,
              scimGroupMappingId: currentMapping.id,
              seesAll: false,
            });
            await tx.insert(schema.scimGroupMemberTable).values({
              scimGroupMappingId: currentMapping.id,
              externalIdentityId: identityId,
              membershipGrantId: grantId,
            });
            grantProjectionKeys.push({
              personId: identity.personId,
              scope: currentMapping.scope,
              scopeId: currentMapping.scopeId,
            });
          }
          await projectMembershipKeys(tx, grantProjectionKeys);
        }
      }

      const [created] = await tx
        .select({ id: schema.scimGroupTable.id })
        .from(schema.scimGroupTable)
        .where(
          and(
            eq(schema.scimGroupTable.scimConnectionId, input.connectionId),
            eq(schema.scimGroupTable.externalId, input.externalId),
          ),
        )
        .limit(1);
      return created?.id ?? group?.id ?? null;
    }),
  );
}
