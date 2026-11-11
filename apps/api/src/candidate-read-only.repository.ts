import { DEFAULT_ROLE_NAMES } from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import db, { schema } from "./database";
import { listAllWorkspaceIds, listWorkspaceRoleKeys } from "./utils/repository";
import {
  findInternalOrganisationId,
  workspaceRoleTableExists,
} from "./utils/seed-defaults.repository";
import { WORKSPACE_BUILT_IN_ROLE_KEYS } from "./workspace/built-in-roles.repository";

export type CandidateBootPrerequisites = {
  hasUserTable: boolean;
  hasSessionTable: boolean;
  hasVerificationTable: boolean;
  hasTwoFactorTable: boolean;
  hasWorkspaceTable: boolean;
  hasWorkspaceRoleTable: boolean;
  hasInternalOrganisation: boolean;
  hasCanonicalWorkspaceRoles: boolean;
  hasActiveWorkspaceFixture?: boolean;
  hasActiveImpersonationSessions?: boolean;
};

async function publicTableExists(tableName: string): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql`SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists"`,
  );
  return Boolean(result.rows[0]?.exists);
}

export async function checkCandidateBootPrerequisites(): Promise<CandidateBootPrerequisites> {
  const [
    hasUserTable,
    hasSessionTable,
    hasVerificationTable,
    hasTwoFactorTable,
    hasWorkspaceTable,
    hasWorkspaceRoleTable,
  ] = await Promise.all([
    publicTableExists("user"),
    publicTableExists("session"),
    publicTableExists("verification"),
    publicTableExists("two_factor"),
    publicTableExists("workspace"),
    workspaceRoleTableExists(),
  ]);

  if (
    !hasUserTable ||
    !hasSessionTable ||
    !hasVerificationTable ||
    !hasTwoFactorTable ||
    !hasWorkspaceTable ||
    !hasWorkspaceRoleTable
  ) {
    return {
      hasUserTable,
      hasSessionTable,
      hasVerificationTable,
      hasTwoFactorTable,
      hasWorkspaceTable,
      hasWorkspaceRoleTable,
      hasInternalOrganisation: false,
      hasCanonicalWorkspaceRoles: false,
      hasActiveWorkspaceFixture: false,
      hasActiveImpersonationSessions: false,
    };
  }

  const [internalOrganisation, workspaces, impersonationRows, membershipRows] =
    await Promise.all([
      findInternalOrganisationId(db),
      listAllWorkspaceIds(db),
      db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(sql`${schema.sessionTable.impersonatedBy} IS NOT NULL`)
        .limit(1),
      db
        .select({ workspaceId: schema.workspaceUserTable.workspaceId })
        .from(schema.workspaceUserTable)
        .limit(1),
    ]);
  const hasInternalOrganisation = Boolean(internalOrganisation);
  const hasActiveWorkspaceFixture =
    workspaces.length > 0 && membershipRows.length > 0;
  const hasActiveImpersonationSessions = impersonationRows.length > 0;

  let hasCanonicalWorkspaceRoles = true;

  if (workspaces.length > 0) {
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const defaultRoleRows = await listWorkspaceRoleKeys(
      db,
      workspaceIds,
      DEFAULT_ROLE_NAMES as unknown as string[],
    );
    const presentDefaultRoles = new Set(
      defaultRoleRows.map((row) => `${row.workspaceId}:${row.role}`),
    );
    const missingDefaultRole = workspaceIds.some((workspaceId) =>
      DEFAULT_ROLE_NAMES.some(
        (name) => !presentDefaultRoles.has(`${workspaceId}:${name}`),
      ),
    );

    const canonicalRoleRows = await db
      .select({
        workspaceId: schema.roleTable.workspaceId,
        key: schema.roleTable.key,
        isSystem: schema.roleTable.isSystem,
        capabilities: schema.roleTable.capabilities,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          inArray(schema.roleTable.workspaceId, workspaceIds),
          inArray(schema.roleTable.key, [...WORKSPACE_BUILT_IN_ROLE_KEYS]),
        ),
      );
    const presentCanonicalRoles = new Set(
      canonicalRoleRows
        .filter(
          (row) =>
            row.isSystem === true &&
            Array.isArray(row.capabilities) &&
            row.capabilities.length > 0,
        )
        .map((row) => `${row.workspaceId}:${row.key}`),
    );
    const missingCanonicalRole = workspaceIds.some((workspaceId) =>
      WORKSPACE_BUILT_IN_ROLE_KEYS.some(
        (key) => !presentCanonicalRoles.has(`${workspaceId}:${key}`),
      ),
    );

    hasCanonicalWorkspaceRoles = !missingDefaultRole && !missingCanonicalRole;
  }

  return {
    hasUserTable,
    hasSessionTable,
    hasVerificationTable,
    hasTwoFactorTable,
    hasWorkspaceTable,
    hasWorkspaceRoleTable,
    hasInternalOrganisation,
    hasCanonicalWorkspaceRoles,
    hasActiveWorkspaceFixture,
    hasActiveImpersonationSessions,
  };
}

async function enrichCandidateSignInUser<
  T extends {
    id: string;
    email: string;
    twoFactorEnabled: boolean | null;
    banned?: boolean | null;
    banReason?: string | null;
    banExpires?: Date | null;
  },
>(user: T | undefined) {
  if (!user) {
    return null;
  }
  const [customerPersonRows, activeMembershipRows] = await Promise.all([
    db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, user.id),
          eq(schema.personTable.side, "customer"),
        ),
      )
      .limit(1),
    db
      .select({ workspaceId: schema.workspaceUserTable.workspaceId })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, user.id))
      .limit(1),
  ]);
  return {
    ...user,
    isCustomerSidePerson: customerPersonRows.length > 0,
    hasActiveWorkspaceMembership: activeMembershipRows.length > 0,
  };
}

export async function findCandidateSignInUserByEmail(email: string) {
  const rows = await db
    .select({
      id: schema.userTable.id,
      email: schema.userTable.email,
      twoFactorEnabled: schema.userTable.twoFactorEnabled,
      banned: schema.userTable.banned,
      banReason: schema.userTable.banReason,
      banExpires: schema.userTable.banExpires,
    })
    .from(schema.userTable)
    .where(sql`lower(${schema.userTable.email}) = lower(${email})`)
    .limit(2);
  // Better Auth resolves a single row by its own lookup. If case variants make the match
  // ambiguous, vetting either row could differ from the one Better Auth signs in, so fail closed.
  if (rows.length > 1) return { ambiguousEmail: true as const };
  return enrichCandidateSignInUser(rows[0]);
}

export async function findCandidateSignInUserById(userId: string) {
  const [user] = await db
    .select({
      id: schema.userTable.id,
      email: schema.userTable.email,
      twoFactorEnabled: schema.userTable.twoFactorEnabled,
      banned: schema.userTable.banned,
      banReason: schema.userTable.banReason,
      banExpires: schema.userTable.banExpires,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return enrichCandidateSignInUser(user);
}

export async function findVerifiedTwoFactorByUserId(userId: string) {
  const [row] = await db
    .select({
      id: schema.twoFactorTable.id,
      userId: schema.twoFactorTable.userId,
      verified: schema.twoFactorTable.verified,
      lockedUntil: schema.twoFactorTable.lockedUntil,
    })
    .from(schema.twoFactorTable)
    .where(
      and(
        eq(schema.twoFactorTable.userId, userId),
        eq(schema.twoFactorTable.verified, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findActiveTwoFactorChallenge(challengeId: string) {
  const [challenge] = await db
    .select({
      id: schema.verificationTable.id,
      identifier: schema.verificationTable.identifier,
      value: schema.verificationTable.value,
      expiresAt: schema.verificationTable.expiresAt,
    })
    .from(schema.verificationTable)
    .where(eq(schema.verificationTable.identifier, challengeId))
    .limit(1);
  return challenge ?? null;
}
