import { createId } from "@paralleldrive/cuid2";
import {
  isCapability,
  type RoleScope,
  roleCompositionProblems,
} from "@taskdesk/permissions";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import db, { schema } from "../database";
import {
  lockAndVerifyScimMutation,
  type ScimRequestAuthority,
} from "./scim-authentication";

type IdentityTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const connectionProjection = {
  id: schema.identityConnectionTable.id,
  providerType: schema.identityConnectionTable.providerType,
  portalScope: schema.identityConnectionTable.portalScope,
  organisationId: schema.identityConnectionTable.organisationId,
  defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
  displayName: schema.identityConnectionTable.displayName,
  issuer: schema.identityConnectionTable.issuer,
  tenantId: schema.identityConnectionTable.tenantId,
  clientId: schema.identityConnectionTable.clientId,
  clientSecret: schema.identityConnectionTable.clientSecret,
  redirectUri: schema.identityConnectionTable.redirectUri,
  scopes: schema.identityConnectionTable.scopes,
  claimMapping: schema.identityConnectionTable.claimMapping,
  domainBindings: schema.identityConnectionTable.domainBindings,
  jitPolicy: schema.identityConnectionTable.jitPolicy,
  maxRoleRank: schema.identityConnectionTable.maxRoleRank,
  mfaUpstreamMode: schema.identityConnectionTable.mfaUpstreamMode,
  enabled: schema.identityConnectionTable.enabled,
  configVersion: schema.identityConnectionTable.configVersion,
  healthState: schema.identityConnectionTable.healthState,
  healthCheckedAt: schema.identityConnectionTable.healthCheckedAt,
} as const;

export function listIdentityConnections() {
  return db
    .select(connectionProjection)
    .from(schema.identityConnectionTable)
    .orderBy(
      schema.identityConnectionTable.portalScope,
      schema.identityConnectionTable.id,
    );
}

export function getIdentityConnection(id: string) {
  return db
    .select(connectionProjection)
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, id))
    .limit(1);
}

export function lockIdentityConnection(tx: IdentityTransaction, id: string) {
  return tx
    .select(connectionProjection)
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, id))
    .for("update")
    .limit(1);
}

export function listIdentityDomainBindings(tx: IdentityTransaction) {
  return tx
    .select({
      id: schema.identityConnectionTable.id,
      domains: schema.identityConnectionTable.domainBindings,
    })
    .from(schema.identityConnectionTable);
}

export function lockCustomerOrganisation(tx: IdentityTransaction, id: string) {
  return tx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(
      and(
        eq(schema.organisationTable.id, id),
        eq(schema.organisationTable.active, true),
        eq(schema.organisationTable.isInternal, false),
        isNull(schema.organisationTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockActiveInternalWorkspace(
  tx: IdentityTransaction,
  workspaceId: string,
) {
  return tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .innerJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
    )
    .where(
      and(
        eq(schema.workspaceTable.id, workspaceId),
        eq(schema.organisationTable.active, true),
        eq(schema.organisationTable.isInternal, true),
        isNull(schema.organisationTable.deletedAt),
        isNull(schema.workspaceTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockIdentityDefaultRole(
  tx: IdentityTransaction,
  roleId: string,
) {
  return tx
    .select({
      id: schema.roleTable.id,
      scope: schema.roleTable.scope,
      workspaceId: schema.roleTable.workspaceId,
      key: schema.roleTable.key,
      rank: schema.roleTable.rank,
      capabilities: schema.roleTable.capabilities,
    })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, roleId))
    .for("update")
    .limit(1);
}

export function getIdentityConnectionIdForOrganisation(id: string) {
  return db
    .select(connectionProjection)
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.organisationId, id))
    .limit(1);
}

export function getIdentityConnectionPresence(id: string) {
  return db
    .select({ id: schema.identityConnectionTable.id })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, id))
    .limit(1);
}

export function listIdentityConnectionEvents(
  connectionId: string,
  after: ReturnType<typeof and> | undefined,
  limit: number,
) {
  const conditions = [
    eq(schema.provisioningEventTable.identityConnectionId, connectionId),
  ];
  if (after) conditions.push(after);
  return db
    .select({
      id: schema.provisioningEventTable.id,
      cursorCreatedAt: sql<string>`to_char(
        ${schema.provisioningEventTable.createdAt} at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )`,
      kind: schema.provisioningEventTable.kind,
      outcome: schema.provisioningEventTable.outcome,
      actorType: schema.provisioningEventTable.actorType,
      createdAt: schema.provisioningEventTable.createdAt,
    })
    .from(schema.provisioningEventTable)
    .where(and(...conditions))
    .orderBy(
      desc(schema.provisioningEventTable.createdAt),
      desc(schema.provisioningEventTable.id),
    )
    .limit(limit + 1);
}

export function getOrganisationPresence(id: string) {
  return db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, id))
    .limit(1);
}

export function getIdentityPersonForUser(userId: string) {
  return db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
}

export function getIdentityPersonForUserInTransaction(
  tx: IdentityTransaction,
  userId: string,
) {
  return tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
}

export function getCurrentInstanceAdminPersonInTransaction(
  tx: IdentityTransaction,
  userId: string,
) {
  return tx
    .select({ id: schema.personTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .limit(1);
}

export function lockFullIdentityConnection(
  tx: IdentityTransaction,
  id: string,
) {
  return tx
    .select()
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, id))
    .for("update")
    .limit(1);
}

export function lockFullScimConnection(tx: IdentityTransaction, id: string) {
  return tx
    .select()
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, id))
    .for("update")
    .limit(1);
}

export function findScimGroupMapping(
  tx: IdentityTransaction,
  connectionId: string,
  externalGroupId: string,
) {
  return tx
    .select({ id: schema.scimGroupMappingTable.id })
    .from(schema.scimGroupMappingTable)
    .where(
      and(
        eq(schema.scimGroupMappingTable.scimConnectionId, connectionId),
        eq(schema.scimGroupMappingTable.externalGroupId, externalGroupId),
      ),
    )
    .limit(1);
}

export function lockScimGroupMappingById(
  tx: IdentityTransaction,
  connectionId: string,
  mappingId: string,
) {
  return tx
    .select()
    .from(schema.scimGroupMappingTable)
    .where(
      and(
        eq(schema.scimGroupMappingTable.id, mappingId),
        eq(schema.scimGroupMappingTable.scimConnectionId, connectionId),
      ),
    )
    .for("update")
    .limit(1);
}

export function getScimConnectionVersion(tx: IdentityTransaction, id: string) {
  return tx
    .select({ version: schema.identityConnectionTable.configVersion })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, id))
    .limit(1);
}

export function findIdentityConnectionForOrganisation(
  tx: IdentityTransaction,
  organisationId: string,
) {
  return tx
    .select({ id: schema.identityConnectionTable.id })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.organisationId, organisationId))
    .limit(1);
}

export function getWorkspaceOrganisation(
  tx: IdentityTransaction,
  workspaceId: string,
) {
  return tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
}

export function getIdentityConnectionConfiguration(id: string) {
  return db
    .select({
      tenantId: schema.identityConnectionTable.tenantId,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
      jitPolicy: schema.identityConnectionTable.jitPolicy,
      configVersion: schema.identityConnectionTable.configVersion,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, id))
    .limit(1);
}

export function getScimSettingsRow(connectionId: string) {
  return db
    .select({
      id: schema.identityConnectionTable.id,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      configVersion: schema.identityConnectionTable.configVersion,
      enabled: schema.scimConnectionTable.enabled,
      allowedResources: schema.scimConnectionTable.allowedResources,
      lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy,
      attributeMapping: schema.scimConnectionTable.attributeMapping,
      matchAttributes: schema.scimConnectionTable.matchAttributes,
    })
    .from(schema.identityConnectionTable)
    .innerJoin(
      schema.scimConnectionTable,
      eq(
        schema.scimConnectionTable.identityConnectionId,
        schema.identityConnectionTable.id,
      ),
    )
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getScimMatchAttributes(connectionId: string) {
  return db
    .select({ matchAttributes: schema.scimConnectionTable.matchAttributes })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .limit(1);
}

export function getScimLifecyclePolicy(connectionId: string) {
  return db
    .select({ lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .limit(1);
}

export function getScimLifecyclePolicyInTransaction(
  tx: IdentityTransaction,
  connectionId: string,
) {
  return tx
    .select({ lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .limit(1);
}

export function lockScimProfileOrganisation(
  tx: IdentityTransaction,
  organisationId: string,
) {
  return tx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, organisationId))
    .for("update");
}

export function lockScimProfilePerson(
  tx: IdentityTransaction,
  personId: string,
) {
  return tx
    .select({ organisationId: schema.personTable.organisationId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .for("update");
}

export function getScimGroupForProtocol(connectionId: string, groupId: string) {
  return db
    .select({
      id: schema.scimGroupTable.id,
      externalId: schema.scimGroupTable.externalId,
      displayName: schema.scimGroupTable.displayName,
      active: schema.scimGroupTable.active,
      createdAt: schema.scimGroupTable.createdAt,
      updatedAt: schema.scimGroupTable.updatedAt,
    })
    .from(schema.scimGroupTable)
    .where(
      and(
        eq(schema.scimGroupTable.scimConnectionId, connectionId),
        eq(schema.scimGroupTable.id, groupId),
      ),
    )
    .limit(1);
}

export function listActiveScimGroupMembers(
  connectionId: string,
  groupId: string,
) {
  return db
    .select({
      value: schema.externalIdentityTable.id,
      display: schema.personTable.displayName,
    })
    .from(schema.scimGroupDirectoryMemberTable)
    .innerJoin(
      schema.externalIdentityTable,
      eq(
        schema.externalIdentityTable.id,
        schema.scimGroupDirectoryMemberTable.externalIdentityId,
      ),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(
      and(
        eq(schema.scimGroupDirectoryMemberTable.scimConnectionId, connectionId),
        eq(schema.scimGroupDirectoryMemberTable.scimGroupId, groupId),
        eq(schema.scimGroupDirectoryMemberTable.active, true),
      ),
    );
}

export const scimUserProjection = {
  id: schema.externalIdentityTable.id,
  externalId: schema.externalIdentityTable.scimExternalId,
  userName: schema.externalIdentityTable.userNameSnapshot,
  email: schema.externalIdentityTable.emailSnapshot,
  active: schema.personTable.active,
  displayName: schema.personTable.displayName,
  title: schema.personTable.jobTitle,
  locale: schema.personTable.locale,
  createdAt: schema.externalIdentityTable.firstSeenAt,
  updatedAt: schema.personTable.updatedAt,
} as const;

export function countScimUsers(where: SQL | undefined) {
  return db
    .select({ totalResults: sql<number>`count(*)::int` })
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(where);
}

export function listScimUsers(
  where: SQL | undefined,
  pageCount: number,
  offset: number,
) {
  return db
    .select(scimUserProjection)
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(where)
    .orderBy(schema.externalIdentityTable.id)
    .limit(pageCount)
    .offset(offset);
}

export function getScimUser(where: SQL | undefined) {
  return db
    .select(scimUserProjection)
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(where)
    .limit(1);
}

export function findScimCreateIdentityConflict(
  tx: IdentityTransaction,
  connectionId: string,
  externalId: string,
  userName: string,
) {
  return tx
    .select({ id: schema.externalIdentityTable.id })
    .from(schema.externalIdentityTable)
    .where(
      and(
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        sql`(${schema.externalIdentityTable.scimExternalId} = ${externalId} or lower(${schema.externalIdentityTable.userNameSnapshot}) = ${userName.toLowerCase()})`,
      ),
    )
    .limit(1);
}

export function findScimCreateEmailConflict(
  tx: IdentityTransaction,
  email: string,
) {
  return tx
    .select({ id: schema.externalIdentityTable.id })
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      sql`lower(${schema.externalIdentityTable.emailSnapshot}) = lower(${email}) or lower(${schema.userTable.email}) = lower(${email})`,
    )
    .limit(1);
}

export function findScimReplaceEmailConflict(
  email: string,
  identityId: string,
  personId: string,
) {
  return db
    .select({ id: schema.externalIdentityTable.id })
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        sql`(lower(${schema.externalIdentityTable.emailSnapshot}) = lower(${email}) and ${schema.externalIdentityTable.id} <> ${identityId}) or (lower(${schema.userTable.email}) = lower(${email}) and ${schema.personTable.id} <> ${personId})`,
      ),
    )
    .limit(1);
}

export function findActiveInternalOrganisation(tx: IdentityTransaction) {
  return tx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(
      and(
        eq(schema.organisationTable.isInternal, true),
        eq(schema.organisationTable.active, true),
        isNull(schema.organisationTable.deletedAt),
      ),
    )
    .limit(1);
}

export function countScimGroups(connectionId: string) {
  return db
    .select({ totalResults: sql<number>`count(*)::int` })
    .from(schema.scimGroupTable)
    .where(eq(schema.scimGroupTable.scimConnectionId, connectionId));
}

export function listScimGroupIds(
  connectionId: string,
  pageCount: number,
  offset: number,
) {
  return db
    .select({ id: schema.scimGroupTable.id })
    .from(schema.scimGroupTable)
    .where(eq(schema.scimGroupTable.scimConnectionId, connectionId))
    .orderBy(schema.scimGroupTable.id)
    .limit(pageCount)
    .offset(offset);
}

export function getScimProfileMapping(connectionId: string) {
  return db
    .select({ mapping: schema.scimConnectionTable.attributeMapping })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .limit(1);
}

export function getScimCurrentUserForReplace(where: SQL | undefined) {
  return db
    .select({
      id: schema.externalIdentityTable.id,
      externalId: schema.externalIdentityTable.scimExternalId,
      personId: schema.externalIdentityTable.personId,
      organisationId: schema.personTable.organisationId,
      userName: schema.externalIdentityTable.userNameSnapshot,
      email: schema.externalIdentityTable.emailSnapshot,
      active: schema.personTable.active,
      displayName: schema.personTable.displayName,
      title: schema.personTable.jobTitle,
      locale: schema.personTable.locale,
    })
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(where)
    .limit(1);
}

export function getScimCurrentUserForPatch(where: SQL | undefined) {
  return db
    .select({
      id: schema.externalIdentityTable.id,
      personId: schema.externalIdentityTable.personId,
      organisationId: schema.personTable.organisationId,
      userName: schema.externalIdentityTable.userNameSnapshot,
      email: schema.externalIdentityTable.emailSnapshot,
      active: schema.personTable.active,
      displayName: schema.personTable.displayName,
      title: schema.personTable.jobTitle,
      locale: schema.personTable.locale,
    })
    .from(schema.externalIdentityTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(where)
    .limit(1);
}

export function listScimGroupMappings(connectionId: string) {
  return db
    .select({
      id: schema.scimGroupMappingTable.id,
      externalGroupId: schema.scimGroupMappingTable.externalGroupId,
      externalGroupNameSnapshot:
        schema.scimGroupMappingTable.externalGroupNameSnapshot,
      roleId: schema.scimGroupMappingTable.roleId,
      scope: schema.scimGroupMappingTable.scope,
      scopeId: schema.scimGroupMappingTable.scopeId,
      enabled: schema.scimGroupMappingTable.enabled,
    })
    .from(schema.scimGroupMappingTable)
    .where(eq(schema.scimGroupMappingTable.scimConnectionId, connectionId))
    .orderBy(
      schema.scimGroupMappingTable.externalGroupId,
      schema.scimGroupMappingTable.id,
    );
}

export function listOidcGroupMappings(connectionId: string) {
  return db
    .select({
      id: schema.oidcGroupMappingTable.id,
      externalGroupId: schema.oidcGroupMappingTable.externalGroupId,
      externalGroupNameSnapshot:
        schema.oidcGroupMappingTable.externalGroupNameSnapshot,
      roleId: schema.oidcGroupMappingTable.roleId,
      scope: schema.oidcGroupMappingTable.scope,
      scopeId: schema.oidcGroupMappingTable.scopeId,
      enabled: schema.oidcGroupMappingTable.enabled,
      createdAt: schema.oidcGroupMappingTable.createdAt,
      updatedAt: schema.oidcGroupMappingTable.updatedAt,
    })
    .from(schema.oidcGroupMappingTable)
    .where(eq(schema.oidcGroupMappingTable.identityConnectionId, connectionId))
    .orderBy(
      schema.oidcGroupMappingTable.externalGroupId,
      schema.oidcGroupMappingTable.id,
    );
}

export function getOidcMappingAdminConnection(connectionId: string) {
  return db
    .select({
      id: schema.identityConnectionTable.id,
      providerType: schema.identityConnectionTable.providerType,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      maxRoleRank: schema.identityConnectionTable.maxRoleRank,
      configVersion: schema.identityConnectionTable.configVersion,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getOidcGroupMappingById(
  connectionId: string,
  mappingId: string,
) {
  return db
    .select()
    .from(schema.oidcGroupMappingTable)
    .where(
      and(
        eq(schema.oidcGroupMappingTable.identityConnectionId, connectionId),
        eq(schema.oidcGroupMappingTable.id, mappingId),
      ),
    )
    .limit(1);
}

export function findOidcGroupMapping(
  tx: IdentityTransaction,
  connectionId: string,
  externalGroupId: string,
) {
  return tx
    .select({ id: schema.oidcGroupMappingTable.id })
    .from(schema.oidcGroupMappingTable)
    .where(
      and(
        eq(schema.oidcGroupMappingTable.identityConnectionId, connectionId),
        eq(schema.oidcGroupMappingTable.externalGroupId, externalGroupId),
      ),
    )
    .limit(1);
}

export function lockOidcGroupMappingById(
  tx: IdentityTransaction,
  connectionId: string,
  mappingId: string,
) {
  return tx
    .select()
    .from(schema.oidcGroupMappingTable)
    .where(
      and(
        eq(schema.oidcGroupMappingTable.identityConnectionId, connectionId),
        eq(schema.oidcGroupMappingTable.id, mappingId),
      ),
    )
    .for("update")
    .limit(1);
}

export async function validateOidcMappingRole(
  tx: IdentityTransaction,
  input: {
    providerType: string;
    portalScope: string;
    organisationId: string | null;
    maxRoleRank: number | null;
    scope: "organisation" | "workspace";
    scopeId: string;
    roleId: string;
  },
) {
  if (input.providerType !== "entra") return false;
  if (input.portalScope === "customer") {
    if (
      input.scope !== "organisation" ||
      !input.organisationId ||
      input.scopeId !== input.organisationId ||
      input.maxRoleRank !== null
    )
      return false;
    const [organisation] = await tx
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(
        and(
          eq(schema.organisationTable.id, input.organisationId),
          eq(schema.organisationTable.active, true),
          eq(schema.organisationTable.portalAccess, true),
          eq(schema.organisationTable.isInternal, false),
          isNull(schema.organisationTable.deletedAt),
        ),
      )
      .limit(1);
    if (!organisation) return false;
  } else if (input.portalScope === "agent") {
    if (
      input.scope !== "workspace" ||
      !input.scopeId ||
      input.organisationId !== null ||
      input.maxRoleRank === null
    )
      return false;
    const [workspace] = await tx
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .innerJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
      )
      .where(
        and(
          eq(schema.workspaceTable.id, input.scopeId),
          isNull(schema.workspaceTable.deletedAt),
          eq(schema.organisationTable.active, true),
          eq(schema.organisationTable.isInternal, true),
          isNull(schema.organisationTable.deletedAt),
        ),
      )
      .limit(1);
    if (!workspace) return false;
  } else return false;

  const [role] = await tx
    .select({
      scope: schema.roleTable.scope,
      workspaceId: schema.roleTable.workspaceId,
      key: schema.roleTable.key,
      rank: schema.roleTable.rank,
      capabilities: schema.roleTable.capabilities,
    })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, input.roleId))
    .limit(1);
  if (!role || role.scope !== input.scope || role.rank < 0) return false;
  if (!hasSafeOidcRoleCapabilities(role.scope, role.capabilities)) return false;
  if (input.portalScope === "customer")
    return role.workspaceId === null && role.key === "customer";
  if (
    input.maxRoleRank === null ||
    role.rank > input.maxRoleRank ||
    role.workspaceId !== input.scopeId ||
    role.key === "admin" ||
    role.key === "owner"
  )
    return false;
  return true;
}

function hasSafeOidcRoleCapabilities(scope: string, value: unknown): boolean {
  if (scope !== "organisation" && scope !== "workspace") return false;
  if (
    !Array.isArray(value) ||
    !value.every(
      (capability): capability is string =>
        typeof capability === "string" &&
        capability !== "sees_all" &&
        isCapability(capability),
    )
  )
    return false;
  return roleCompositionProblems(scope as RoleScope, value).length === 0;
}

export async function retireOidcGroupGrants(
  tx: IdentityTransaction,
  mappingId: string,
) {
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
        eq(schema.membershipGrantTable.sourceKind, "oidc_group"),
        eq(schema.membershipGrantTable.oidcGroupMappingId, mappingId),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .orderBy(schema.membershipGrantTable.id)
    .for("update");
  if (!active.length) return [];
  const now = new Date();
  await tx
    .update(schema.membershipGrantTable)
    .set({
      revokedAt: now,
      revocationReason: "mapping_changed",
      updatedAt: now,
      membershipId: null,
    })
    .where(
      inArray(
        schema.membershipGrantTable.id,
        active.map(({ id }) => id),
      ),
    );
  await projectMembershipKeys(
    tx,
    active.map(({ personId, scope, scopeId }) => ({
      personId,
      scope,
      scopeId,
    })),
  );
  return active;
}

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
    sourceKinds?: readonly ("jit_default" | "oidc_group" | "scim_group")[];
    actorPersonId?: string;
    proposedRoleId?: string;
    proposedScope?: string;
    proposedScopeId?: string;
    proposedOrganisationId?: string;
    mappingId?: string;
    additionalProjectionKeys?: readonly (MembershipProjectionKey & {
      roleId: string;
      externalIdentityId: string;
    })[];
    scimGroupIds?: readonly string[];
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
        ...(input.sourceKinds
          ? [inArray(schema.membershipGrantTable.sourceKind, input.sourceKinds)]
          : [eq(schema.membershipGrantTable.sourceKind, "scim_group")]),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  const projectionKeys = [
    ...new Map(
      [...discovered, ...(input.additionalProjectionKeys ?? [])].map(
        (grant) => [
          `${grant.personId}\0${grant.scope}\0${grant.scopeId}`,
          {
            personId: grant.personId,
            scope: grant.scope,
            scopeId: grant.scopeId,
          },
        ],
      ),
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
      ...(input.additionalProjectionKeys ?? []).map(() => input.connectionId),
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
  const oidcMappings = await tx
    .select({
      id: schema.oidcGroupMappingTable.id,
      roleId: schema.oidcGroupMappingTable.roleId,
      scope: schema.oidcGroupMappingTable.scope,
      scopeId: schema.oidcGroupMappingTable.scopeId,
    })
    .from(schema.oidcGroupMappingTable)
    .where(
      eq(schema.oidcGroupMappingTable.identityConnectionId, input.connectionId),
    );
  const proposedScope =
    input.proposedScope ??
    mappings.find((mapping) => mapping.id === input.mappingId)?.scope;
  const personIds = [
    ...new Set([
      ...discovered.map((grant) => grant.personId),
      ...(input.additionalProjectionKeys ?? []).map((grant) => grant.personId),
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
      ...(input.proposedOrganisationId ? [input.proposedOrganisationId] : []),
      ...mappings
        .filter((mapping) => mapping.scope === "organisation")
        .map((mapping) => mapping.scopeId),
      ...oidcMappings
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
      ...projectionKeys
        .filter((key) => key.scope === "workspace")
        .map((key) => key.scopeId),
      ...mappings
        .filter((mapping) => mapping.scope === "workspace")
        .map((mapping) => mapping.scopeId),
      ...oidcMappings
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
      ...(input.additionalProjectionKeys ?? []).map((grant) => grant.roleId),
      ...mappings.map((mapping) => mapping.roleId),
      ...oidcMappings.map((mapping) => mapping.roleId),
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
    ...new Set([
      ...projectionGrants.flatMap((grant) =>
        grant.oidcGroupMappingId ? [grant.oidcGroupMappingId] : [],
      ),
      ...oidcMappings.map(({ id }) => id),
    ]),
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
  if (input.scimGroupIds?.length) {
    await tx
      .select({ id: schema.scimGroupTable.id })
      .from(schema.scimGroupTable)
      .where(
        and(
          eq(schema.scimGroupTable.scimConnectionId, input.connectionId),
          inArray(schema.scimGroupTable.id, [...input.scimGroupIds].sort()),
        ),
      )
      .orderBy(schema.scimGroupTable.id)
      .for("update");
  }
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
  const currentOidcMappings = await tx
    .select({
      id: schema.oidcGroupMappingTable.id,
      roleId: schema.oidcGroupMappingTable.roleId,
      scope: schema.oidcGroupMappingTable.scope,
      scopeId: schema.oidcGroupMappingTable.scopeId,
    })
    .from(schema.oidcGroupMappingTable)
    .where(
      eq(schema.oidcGroupMappingTable.identityConnectionId, input.connectionId),
    )
    .orderBy(schema.oidcGroupMappingTable.id);
  const oidcMappingKey = (mapping: (typeof oidcMappings)[number]) =>
    [mapping.id, mapping.roleId, mapping.scope, mapping.scopeId].join("\0");
  const discoveredOidcMappingKeys = oidcMappings.map(oidcMappingKey).sort();
  const currentOidcMappingKeys = currentOidcMappings.map(oidcMappingKey).sort();
  if (
    discoveredOidcMappingKeys.length !== currentOidcMappingKeys.length ||
    currentOidcMappingKeys.some(
      (key, index) => key !== discoveredOidcMappingKeys[index],
    )
  )
    throw new IdentityGrantClosureChangedError();
  const identityIds = [
    ...new Set([
      ...projectionGrants.flatMap((grant) =>
        grant.externalIdentityId ? [grant.externalIdentityId] : [],
      ),
      ...(input.additionalProjectionKeys ?? []).map(
        (grant) => grant.externalIdentityId,
      ),
    ]),
  ].sort();
  if (identityIds.length) {
    await tx
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(inArray(schema.externalIdentityTable.id, identityIds))
      .orderBy(schema.externalIdentityTable.id)
      .for("update");
  }
  if (input.scimGroupIds?.length) {
    await tx
      .select({ id: schema.scimGroupDirectoryMemberTable.id })
      .from(schema.scimGroupDirectoryMemberTable)
      .where(
        and(
          eq(
            schema.scimGroupDirectoryMemberTable.scimConnectionId,
            input.connectionId,
          ),
          inArray(
            schema.scimGroupDirectoryMemberTable.scimGroupId,
            [...input.scimGroupIds].sort(),
          ),
        ),
      )
      .orderBy(schema.scimGroupDirectoryMemberTable.id)
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
        ...(input.sourceKinds
          ? [inArray(schema.membershipGrantTable.sourceKind, input.sourceKinds)]
          : [eq(schema.membershipGrantTable.sourceKind, "scim_group")]),
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
      grant.oidcGroupMappingId,
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

export function getScimIdentityByTokenDigest(digest: Buffer) {
  return db
    .select({
      connectionId: schema.scimConnectionTable.identityConnectionId,
      enabled: schema.scimConnectionTable.enabled,
      allowedResources: schema.scimConnectionTable.allowedResources,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      connectionEnabled: schema.identityConnectionTable.enabled,
      maxRoleRank: schema.identityConnectionTable.maxRoleRank,
    })
    .from(schema.scimConnectionTable)
    .innerJoin(
      schema.identityConnectionTable,
      eq(
        schema.identityConnectionTable.id,
        schema.scimConnectionTable.identityConnectionId,
      ),
    )
    .where(
      and(
        eq(schema.scimConnectionTable.tokenHash, digest),
        isNotNull(schema.scimConnectionTable.tokenHash),
      ),
    )
    .limit(1);
}

export function lockScimIdentityConnection(
  executor: IdentityTransaction,
  connectionId: string,
) {
  return executor
    .select({
      issuer: schema.identityConnectionTable.issuer,
      enabled: schema.identityConnectionTable.enabled,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .for("update");
}

export function lockScimConnection(
  executor: IdentityTransaction,
  connectionId: string,
) {
  return executor
    .select({
      enabled: schema.scimConnectionTable.enabled,
      tokenHash: schema.scimConnectionTable.tokenHash,
      allowedResources: schema.scimConnectionTable.allowedResources,
      attributeMapping: schema.scimConnectionTable.attributeMapping,
      lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy,
    })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .for("update");
}

export function getScimExternalIdentity(
  executor: IdentityTransaction,
  identityId: string,
  connectionId: string,
) {
  return executor
    .select({ personId: schema.externalIdentityTable.personId })
    .from(schema.externalIdentityTable)
    .where(
      and(
        eq(schema.externalIdentityTable.id, identityId),
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        eq(schema.externalIdentityTable.provisionedVia, "scim"),
      ),
    )
    .limit(1);
}

export function lockOidcConnection(
  tx: IdentityTransaction,
  connectionId: string,
) {
  return tx
    .select({
      id: schema.identityConnectionTable.id,
      enabled: schema.identityConnectionTable.enabled,
      portalScope: schema.identityConnectionTable.portalScope,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .for("update")
    .limit(1);
}

export function lockOidcExternalIdentity(
  tx: IdentityTransaction,
  connectionId: string,
  userId: string,
) {
  return tx
    .select({ id: schema.externalIdentityTable.id })
    .from(schema.externalIdentityTable)
    .where(
      and(
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        eq(schema.externalIdentityTable.userId, userId),
        eq(schema.externalIdentityTable.active, true),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockOidcVerification(
  tx: IdentityTransaction,
  identifier: string,
) {
  return tx
    .select()
    .from(schema.verificationTable)
    .where(eq(schema.verificationTable.identifier, identifier))
    .for("update")
    .limit(1);
}

export function getOidcConnectionForStart(connectionId: string) {
  return db
    .select({
      id: schema.identityConnectionTable.id,
      portalScope: schema.identityConnectionTable.portalScope,
      enabled: schema.identityConnectionTable.enabled,
      tenantId: schema.identityConnectionTable.tenantId,
      defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
      issuer: schema.identityConnectionTable.issuer,
      clientId: schema.identityConnectionTable.clientId,
      redirectUri: schema.identityConnectionTable.redirectUri,
      scopes: schema.identityConnectionTable.scopes,
      claimMapping: schema.identityConnectionTable.claimMapping,
      jitPolicy: schema.identityConnectionTable.jitPolicy,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getOidcConnectionForCallback(connectionId: string) {
  return db
    .select()
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getOidcIdentityForSignIn(
  tx: IdentityTransaction,
  input: { connectionId: string; issuer: string; subject: string },
) {
  return tx
    .select({
      id: schema.externalIdentityTable.id,
      personId: schema.externalIdentityTable.personId,
      userId: schema.externalIdentityTable.userId,
      active: schema.externalIdentityTable.active,
      personActive: schema.personTable.active,
      side: schema.personTable.side,
      organisationId: schema.personTable.organisationId,
      personUserId: schema.personTable.userId,
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
        eq(schema.externalIdentityTable.issuer, input.issuer),
        eq(schema.externalIdentityTable.subject, input.subject),
      ),
    )
    .for("update", { of: schema.externalIdentityTable })
    .limit(1);
}

export function findOidcEmailOwner(tx: IdentityTransaction, email: string) {
  return tx
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
}

export function lockOidcDefaultRole(tx: IdentityTransaction, roleId: string) {
  return tx
    .select({
      id: schema.roleTable.id,
      scope: schema.roleTable.scope,
      rank: schema.roleTable.rank,
      key: schema.roleTable.key,
      workspaceId: schema.roleTable.workspaceId,
      capabilities: schema.roleTable.capabilities,
    })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, roleId))
    .for("update")
    .limit(1);
}

export function lockOidcDefaultWorkspace(
  tx: IdentityTransaction,
  workspaceId: string,
) {
  return tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .innerJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
    )
    .where(
      and(
        eq(schema.workspaceTable.id, workspaceId),
        isNull(schema.workspaceTable.deletedAt),
        eq(schema.organisationTable.isInternal, true),
        isNull(schema.organisationTable.deletedAt),
      ),
    )
    .for("update", { of: schema.workspaceTable })
    .limit(1);
}

export function lockOidcPerson(tx: IdentityTransaction, personId: string) {
  return tx
    .select({ id: schema.personTable.id, userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .for("update")
    .limit(1);
}

export function listEnabledOidcDomainOwners() {
  return db
    .select({
      domain: sql<string>`unnest(${schema.identityConnectionTable.domainBindings})`,
      identityConnectionId: schema.identityConnectionTable.id,
    })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.enabled, true));
}

export function getOidcUserFactorState(userId: string) {
  return db
    .select({ enabled: schema.userTable.twoFactorEnabled })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
}

/** Revoke only grants sourced by one identity connection and reproject their scopes. */
export async function retireConnectionGrantSources(
  tx: IdentityTransaction,
  connectionId: string,
) {
  const keys = await lockScimGrantClosure(tx, {
    connectionId,
    sourceKinds: ["jit_default", "oidc_group", "scim_group"],
  });
  const grants = await tx
    .select({ id: schema.membershipGrantTable.id })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.identityConnectionId, connectionId),
        inArray(schema.membershipGrantTable.sourceKind, [
          "jit_default",
          "oidc_group",
          "scim_group",
        ]),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .for("update");
  const now = new Date();
  if (grants.length) {
    const grantIds = grants.map((grant) => grant.id);
    await tx
      .update(schema.scimGroupMemberTable)
      .set({ revokedAt: now, membershipId: null })
      .where(inArray(schema.scimGroupMemberTable.membershipGrantId, grantIds));
    await tx
      .update(schema.membershipGrantTable)
      .set({
        revokedAt: now,
        revocationReason: "connection_disabled",
        membershipId: null,
        updatedAt: now,
      })
      .where(inArray(schema.membershipGrantTable.id, grantIds));
  }
  await projectMembershipKeys(tx, keys);
  return { retiredGrantCount: grants.length, projectionKeys: keys };
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
    externalIdentityIds?: readonly string[];
    connectionId?: string;
    reason:
      | "mapping_changed"
      | "mapping_disabled"
      | "connection_disabled"
      | "scim_group_removed";
  },
) {
  if (
    (!input.mappingIds?.length && !input.connectionId) ||
    (input.externalIdentityIds !== undefined &&
      input.externalIdentityIds.length === 0)
  )
    return [];
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
        input.externalIdentityIds?.length
          ? inArray(schema.membershipGrantTable.externalIdentityId, [
              ...input.externalIdentityIds,
            ])
          : undefined,
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
  return { sessionsRevoked, keysRevoked, membershipsEnded };
}

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

export async function validateScimMappingRole(
  tx: IdentityTransaction,
  input: {
    portalScope: string;
    organisationId: string | null;
    maxRoleRank: number | null;
    scope: "organisation" | "workspace";
    scopeId?: string;
    roleId: string;
  },
) {
  if (input.portalScope === "customer") {
    if (input.scope !== "organisation" || !input.organisationId) return false;
    const [org] = await tx
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(
        and(
          eq(schema.organisationTable.id, input.organisationId),
          eq(schema.organisationTable.active, true),
          eq(schema.organisationTable.portalAccess, true),
          eq(schema.organisationTable.isInternal, false),
          sql`${schema.organisationTable.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!org) return false;
  } else if (input.portalScope === "agent") {
    if (
      input.scope !== "workspace" ||
      !input.scopeId ||
      input.maxRoleRank === null
    )
      return false;
    const [workspace] = await tx
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .innerJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
      )
      .where(
        and(
          eq(schema.workspaceTable.id, input.scopeId),
          sql`${schema.workspaceTable.deletedAt} is null`,
          eq(schema.organisationTable.isInternal, true),
          eq(schema.organisationTable.active, true),
          sql`${schema.organisationTable.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!workspace) return false;
  } else return false;

  const [role] = await tx
    .select({
      scope: schema.roleTable.scope,
      roleKey: schema.roleTable.key,
      rank: schema.roleTable.rank,
      capabilities: schema.roleTable.capabilities,
      workspaceId: schema.roleTable.workspaceId,
    })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, input.roleId))
    .limit(1);
  if (!role || role.scope !== input.scope) return false;
  if (input.portalScope === "customer") return role.roleKey === "customer";
  if (input.maxRoleRank === null || role.rank > input.maxRoleRank) return false;
  if (role.workspaceId !== null && role.workspaceId !== input.scopeId)
    return false;
  if (
    !Array.isArray(role.capabilities) ||
    !role.capabilities.every(
      (capability): capability is string =>
        typeof capability === "string" && isCapability(capability),
    )
  )
    return false;
  const capabilities = role.capabilities;
  return !capabilities.some(
    (capability) =>
      typeof capability === "string" &&
      (capability === "instance:admin" || capability.startsWith("instance:")),
  );
}

type MappingOptionsCursor = {
  v: 1;
  connectionId: string;
  kind: "agent_targets" | "agent_roles";
  workspaceId: string | null;
  afterId: string;
};

function encodeMappingOptionsCursor(value: MappingOptionsCursor) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeMappingOptionsCursor(
  value: string | undefined,
  expected: Omit<MappingOptionsCursor, "afterId">,
): string | null | false {
  if (value === undefined) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !==
        "afterId,connectionId,kind,v,workspaceId"
    )
      return false;
    const cursor = parsed as MappingOptionsCursor;
    if (
      cursor.v !== 1 ||
      cursor.connectionId !== expected.connectionId ||
      cursor.kind !== expected.kind ||
      cursor.workspaceId !== expected.workspaceId ||
      typeof cursor.afterId !== "string" ||
      cursor.afterId.length < 1 ||
      cursor.afterId.length > 128 ||
      encodeMappingOptionsCursor(cursor) !== value
    )
      return false;
    return cursor.afterId;
  } catch {
    return false;
  }
}

export async function readScimMappingOptions(input: {
  connectionId: string;
  workspaceId?: string;
  cursor?: string;
  limit: number;
}) {
  const [connection] = await db
    .select({
      id: schema.identityConnectionTable.id,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      maxRoleRank: schema.identityConnectionTable.maxRoleRank,
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
  if (!connection) return null;

  if (connection.portalScope === "customer") {
    if (input.workspaceId || input.cursor) return false;
    if (!connection.organisationId)
      return {
        kind: "customer" as const,
        target: null,
        role: null,
        nextCursor: null,
      };
    const [target] = await db
      .select({
        id: schema.organisationTable.id,
        name: schema.organisationTable.name,
      })
      .from(schema.organisationTable)
      .where(
        and(
          eq(schema.organisationTable.id, connection.organisationId),
          eq(schema.organisationTable.active, true),
          eq(schema.organisationTable.portalAccess, true),
          eq(schema.organisationTable.isInternal, false),
          isNull(schema.organisationTable.deletedAt),
        ),
      )
      .limit(1);
    if (!target)
      return {
        kind: "customer" as const,
        target: null,
        role: null,
        nextCursor: null,
      };
    const [role] = await db
      .select({
        id: schema.roleTable.id,
        name: schema.roleTable.name,
        rank: schema.roleTable.rank,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "organisation"),
          eq(schema.roleTable.key, "customer"),
          isNull(schema.roleTable.workspaceId),
        ),
      )
      .limit(1);
    if (
      !role ||
      !(await db.transaction((tx) =>
        validateScimMappingRole(tx, {
          portalScope: connection.portalScope,
          organisationId: connection.organisationId,
          maxRoleRank: connection.maxRoleRank,
          scope: "organisation",
          scopeId: connection.organisationId ?? undefined,
          roleId: role.id,
        }),
      ))
    )
      return {
        kind: "customer" as const,
        target: null,
        role: null,
        nextCursor: null,
      };
    return { kind: "customer" as const, target, role, nextCursor: null };
  }

  if (connection.portalScope !== "agent") return null;
  if (!input.workspaceId) {
    const expected = {
      v: 1 as const,
      connectionId: input.connectionId,
      kind: "agent_targets" as const,
      workspaceId: null,
    };
    const afterId = decodeMappingOptionsCursor(input.cursor, expected);
    if (afterId === false) return false;
    const rows = await db
      .select({
        id: schema.workspaceTable.id,
        name: schema.workspaceTable.name,
      })
      .from(schema.workspaceTable)
      .innerJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
      )
      .where(
        and(
          eq(schema.organisationTable.isInternal, true),
          eq(schema.organisationTable.active, true),
          isNull(schema.organisationTable.deletedAt),
          isNull(schema.workspaceTable.deletedAt),
          ...(afterId ? [gt(schema.workspaceTable.id, afterId)] : []),
        ),
      )
      .orderBy(asc(schema.workspaceTable.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const lastTarget = page[page.length - 1];
    const nextCursor =
      rows.length > input.limit && lastTarget
        ? encodeMappingOptionsCursor({
            ...expected,
            afterId: lastTarget.id,
          })
        : null;
    return { kind: "agent_targets" as const, data: page, nextCursor };
  }

  const expected = {
    v: 1 as const,
    connectionId: input.connectionId,
    kind: "agent_roles" as const,
    workspaceId: input.workspaceId,
  };
  const afterId = decodeMappingOptionsCursor(input.cursor, expected);
  if (afterId === false) return false;
  const [target] = await db
    .select({ id: schema.workspaceTable.id, name: schema.workspaceTable.name })
    .from(schema.workspaceTable)
    .innerJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
    )
    .where(
      and(
        eq(schema.workspaceTable.id, input.workspaceId),
        eq(schema.organisationTable.isInternal, true),
        eq(schema.organisationTable.active, true),
        isNull(schema.organisationTable.deletedAt),
        isNull(schema.workspaceTable.deletedAt),
      ),
    )
    .limit(1);
  if (!target) return null;
  const candidateRoles =
    connection.maxRoleRank === null
      ? []
      : await db
          .select({
            id: schema.roleTable.id,
            name: schema.roleTable.name,
            rank: schema.roleTable.rank,
          })
          .from(schema.roleTable)
          .where(
            and(
              eq(schema.roleTable.scope, "workspace"),
              sql`${schema.roleTable.rank} <= ${connection.maxRoleRank}`,
              or(
                eq(schema.roleTable.workspaceId, input.workspaceId),
                isNull(schema.roleTable.workspaceId),
              ),
              ...(afterId ? [gt(schema.roleTable.id, afterId)] : []),
            ),
          )
          .orderBy(asc(schema.roleTable.id))
          .limit(input.limit + 1);
  const candidates = candidateRoles.slice(0, input.limit);
  const lastCandidate = candidates[candidates.length - 1];
  const eligibleRoles = [];
  for (const role of candidates) {
    if (
      await db.transaction((tx) =>
        validateScimMappingRole(tx, {
          portalScope: connection.portalScope,
          organisationId: connection.organisationId,
          maxRoleRank: connection.maxRoleRank,
          scope: "workspace",
          scopeId: input.workspaceId,
          roleId: role.id,
        }),
      )
    )
      eligibleRoles.push(role);
  }
  const nextCursor =
    candidateRoles.length > input.limit && lastCandidate
      ? encodeMappingOptionsCursor({
          ...expected,
          afterId: lastCandidate.id,
        })
      : null;
  return {
    kind: "agent_roles" as const,
    target,
    data: eligibleRoles,
    nextCursor,
  };
}
