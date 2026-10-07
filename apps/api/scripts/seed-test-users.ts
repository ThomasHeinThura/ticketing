import {
  BUILT_IN_ROLE_KEYS,
  BUILT_IN_ROLES,
  DEFAULT_ROLE_NAMES,
} from "@taskdesk/permissions";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { eq, inArray, or } from "drizzle-orm";
import db, { getDatabasePool, schema } from "../src/database";
import { seedDefaultWorkspaceRolesForWorkspace } from "../src/utils/seed-default-workspace-roles";
import { seed } from "./seed-profile";
import {
  generateTestUserPassword,
  readCredentialFile,
  type TestUserCredential,
  type TestUserCredentialManifest,
  validateCredentialFilePath,
  writeCredentialFile,
} from "./test-user-credentials";

const FIXTURE_NAMESPACE = "taskdesk-test-user";
const CUSTOMER_ORGANISATION = {
  id: `${FIXTURE_NAMESPACE}-customer-organisation`,
  key: `${FIXTURE_NAMESPACE}-customer`,
  name: "TaskDesk test customer",
} as const;

export const SUPPORTED_TEST_USER_ROLES = [
  "instance_admin",
  "owner",
  "admin",
  "member",
  "viewer",
  "customer",
] as const;

export function formatTestUserSeedResult(
  userCount: number,
  databaseName: string,
  credentialPath: string,
): string {
  return `Seeded ${userCount} test users for database ${databaseName}. Credentials: ${credentialPath}`;
}

type SupportedRole = (typeof SUPPORTED_TEST_USER_ROLES)[number];

export function parseTestUserRoles(value: string | undefined): SupportedRole[] {
  const requested = value ? value.split(",") : [...SUPPORTED_TEST_USER_ROLES];
  if (requested.length === 0 || requested.some((role) => role.length === 0)) {
    throw new Error("Role list is empty or malformed.");
  }
  const seen = new Set<string>();
  for (const role of requested) {
    if (
      !BUILT_IN_ROLE_KEYS.includes(role as (typeof BUILT_IN_ROLE_KEYS)[number])
    ) {
      throw new Error("Requested role is not canonical.");
    }
    if (!SUPPORTED_TEST_USER_ROLES.includes(role as SupportedRole)) {
      throw new Error(
        "Requested canonical role has no supported test-user grant source.",
      );
    }
    if (seen.has(role)) throw new Error("Role list contains a duplicate.");
    seen.add(role);
  }
  return requested as SupportedRole[];
}

export function expectedTestUserCredentials(
  roles: readonly SupportedRole[],
  customerPasswordEnabled: boolean,
): Pick<TestUserCredential, "role" | "email" | "scope" | "authentication">[] {
  return roles.map((role) => ({
    role,
    email: `${FIXTURE_NAMESPACE}+${role}@taskdesk-test.invalid`,
    authentication:
      role !== "customer" || customerPasswordEnabled
        ? "local_password"
        : "external_provider_required",
    scope: {
      kind: BUILT_IN_ROLES[role].scope,
      scopeId:
        BUILT_IN_ROLES[role].scope === "workspace"
          ? "taskdesk-seed-minimal-workspace"
          : BUILT_IN_ROLES[role].scope === "organisation"
            ? CUSTOMER_ORGANISATION.id
            : null,
    },
  }));
}

async function isCustomerPasswordProviderEnabled(): Promise<boolean> {
  const configured = await db
    .select({
      enabled: schema.instancePluginConfigTable.enabled,
      scope: schema.instancePluginConfigTable.scope,
      portalScope: schema.instancePluginConfigTable.portalScope,
    })
    .from(schema.instancePluginConfigTable)
    .where(eq(schema.instancePluginConfigTable.pluginId, "auth.password"));
  const customerRows = configured.filter(
    (row) =>
      row.scope === "instance" &&
      (row.portalScope === "both" || row.portalScope === "customer"),
  );
  // Customer password sign-in is disabled by default. Existing instance
  // configuration may opt it in; seeding observes but never changes it.
  return customerRows.length > 0 && customerRows.some((row) => row.enabled);
}

function userId(role: SupportedRole): string {
  return `${FIXTURE_NAMESPACE}-${role}`;
}

function personId(role: SupportedRole): string {
  return `${FIXTURE_NAMESPACE}-${role}-person`;
}

function assertCustomerOrganisation(
  row: typeof schema.organisationTable.$inferSelect | undefined,
) {
  if (
    !row ||
    row.id !== CUSTOMER_ORGANISATION.id ||
    row.key !== CUSTOMER_ORGANISATION.key ||
    row.name !== CUSTOMER_ORGANISATION.name ||
    row.isInternal ||
    !row.active ||
    !row.portalAccess ||
    row.deletedAt !== null
  ) {
    throw new Error(
      "Test customer organisation conflicts with the seed contract.",
    );
  }
}

async function existingUsers(roles: readonly SupportedRole[]) {
  const expectations = expectedTestUserCredentials(roles, false);
  const ids = roles.map(userId);
  const emails = expectations.map(({ email }) => email);
  return db
    .select()
    .from(schema.userTable)
    .where(
      or(
        inArray(schema.userTable.id, ids),
        inArray(schema.userTable.email, emails),
      ),
    );
}

async function verifyExistingFixture(
  roles: readonly SupportedRole[],
  credentials: readonly TestUserCredential[],
  workspaceId: string,
  internalOrganisationId: string,
) {
  const users = await existingUsers(roles);
  if (users.length !== roles.length) {
    throw new Error(
      "Existing test users are partial or collide with unrelated accounts.",
    );
  }
  const usersByRole = new Map(
    roles.map((role) => [role, users.find((row) => row.id === userId(role))]),
  );
  const accounts = await db
    .select()
    .from(schema.accountTable)
    .where(inArray(schema.accountTable.userId, roles.map(userId)));
  const people = await db
    .select()
    .from(schema.personTable)
    .where(inArray(schema.personTable.userId, roles.map(userId)));
  const memberships = await db
    .select()
    .from(schema.workspaceUserTable)
    .where(inArray(schema.workspaceUserTable.userId, roles.map(userId)));

  const expectedAccountCount = credentials.filter(
    (credential) => credential.authentication === "local_password",
  ).length;
  if (
    accounts.length !== expectedAccountCount ||
    people.length !== roles.length
  ) {
    throw new Error(
      "Existing test users do not have the complete account/person foundation.",
    );
  }
  const workspaceRoles = roles.filter(
    (role) =>
      role === "owner" ||
      role === "admin" ||
      role === "member" ||
      role === "viewer",
  );
  if (memberships.length !== workspaceRoles.length) {
    throw new Error(
      "Existing test users have unexpected workspace memberships.",
    );
  }
  for (const [index, role] of roles.entries()) {
    const user = usersByRole.get(role);
    const credential = credentials[index];
    const account = accounts.find((row) => row.userId === userId(role));
    const person = people.find((row) => row.userId === userId(role));
    if (
      !user ||
      !credential ||
      user.email !== credential.email ||
      !user.emailVerified ||
      user.name !== `TaskDesk test ${role}` ||
      user.role !== (role === "instance_admin" ? "admin" : null) ||
      (credential.authentication === "local_password" &&
        (account?.providerId !== "credential" ||
          account.id !== `${userId(role)}-credential` ||
          account.accountId !== user.id ||
          !account.password ||
          !credential.password ||
          !(await verifyPassword({
            hash: account.password,
            password: credential.password,
          })))) ||
      (credential.authentication === "external_provider_required" &&
        account !== undefined) ||
      person?.id !== personId(role) ||
      person.organisationId !==
        (role === "customer"
          ? CUSTOMER_ORGANISATION.id
          : internalOrganisationId) ||
      person.side !== (role === "customer" ? "customer" : "staff") ||
      !person.active ||
      person.isPlaceholder
    ) {
      throw new Error(
        "Existing test user does not match its role, scope, or password contract.",
      );
    }

    const workspaceMembership = memberships.find(
      (row) => row.userId === user.id && row.workspaceId === workspaceId,
    );
    if (
      role === "owner" ||
      role === "admin" ||
      role === "member" ||
      role === "viewer"
    ) {
      if (workspaceMembership?.role !== role) {
        throw new Error(
          "Existing workspace test role does not match the seed contract.",
        );
      }
    } else if (workspaceMembership) {
      throw new Error(
        "Non-workspace test user has an unexpected workspace membership.",
      );
    }
  }
}

async function createFixture(
  roles: readonly SupportedRole[],
  credentials: readonly TestUserCredential[],
) {
  const workspaceId = "taskdesk-seed-minimal-workspace";
  const [workspace] = await db
    .select()
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Error("Minimal test workspace was not created.");

  const [existingCustomerOrganisation] = await db
    .select()
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, CUSTOMER_ORGANISATION.id))
    .limit(1);
  if (existingCustomerOrganisation)
    assertCustomerOrganisation(existingCustomerOrganisation);

  const now = new Date();
  const workspaceRoles = roles.filter(
    (
      role,
    ): role is Extract<
      SupportedRole,
      "owner" | "admin" | "member" | "viewer"
    > =>
      role === "owner" ||
      role === "admin" ||
      role === "member" ||
      role === "viewer",
  );
  const [internal] = await db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);
  if (!internal) throw new Error("Internal test organisation is missing.");

  await db.transaction(async (tx) => {
    await seedDefaultWorkspaceRolesForWorkspace(workspaceId, tx);
    if (!existingCustomerOrganisation && roles.includes("customer")) {
      await tx.insert(schema.organisationTable).values({
        ...CUSTOMER_ORGANISATION,
        isInternal: false,
        active: true,
        portalAccess: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const [index, role] of roles.entries()) {
      const credential = credentials[index];
      if (!credential)
        throw new Error("Missing generated test-user credential.");
      const id = userId(role);
      const person = personId(role);
      const email = credential.email;
      await tx.insert(schema.userTable).values({
        id,
        name: `TaskDesk test ${role}`,
        email,
        emailVerified: true,
        role: role === "instance_admin" ? "admin" : null,
        createdAt: now,
        updatedAt: now,
      });
      if (credential.authentication === "local_password") {
        if (!credential.password)
          throw new Error("Local test password was not generated.");
        await tx.insert(schema.accountTable).values({
          id: `${id}-credential`,
          accountId: id,
          providerId: "credential",
          userId: id,
          password: await hashPassword(credential.password),
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx.insert(schema.personTable).values({
        id: person,
        userId: id,
        organisationId:
          role === "customer" ? CUSTOMER_ORGANISATION.id : internal.id,
        side: role === "customer" ? "customer" : "staff",
        displayName: `TaskDesk test ${role}`,
        active: true,
        isPlaceholder: false,
        createdAt: now,
        updatedAt: now,
      });
      if (workspaceRoles.includes(role as (typeof workspaceRoles)[number])) {
        await tx.insert(schema.workspaceUserTable).values({
          id: `${id}-workspace-membership`,
          workspaceId,
          userId: id,
          role,
          joinedAt: now,
        });
      }
    }
  });
}

function parseArgs(args: readonly string[]) {
  let databaseName: string | undefined;
  let credentialPath: string | undefined;
  let roles: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--test-database" && value) databaseName = value;
    else if (arg === "--credentials-file" && value) credentialPath = value;
    else if (arg === "--roles" && value) roles = value;
    else
      throw new Error(
        "Usage: pnpm seed:test-users -- --test-database <name> --credentials-file <absolute-path> [--roles <csv>]",
      );
    index += 1;
  }
  if (!databaseName || !credentialPath) {
    throw new Error(
      "Usage: pnpm seed:test-users -- --test-database <name> --credentials-file <absolute-path> [--roles <csv>]",
    );
  }
  if (!databaseName.endsWith("_test"))
    throw new Error(
      "Test user seeding requires a database name ending in _test.",
    );
  const parsedRoles = parseTestUserRoles(roles);
  if (parsedRoles.length !== SUPPORTED_TEST_USER_ROLES.length) {
    throw new Error(
      "The test-user batch must include every currently supported role.",
    );
  }
  return { databaseName, credentialPath, roles: parsedRoles };
}

export async function seedTestUsers(
  configuredDatabaseName: string,
  args = process.argv.slice(2),
) {
  const parsed = parseArgs(args);
  if (configuredDatabaseName !== parsed.databaseName) {
    throw new Error(
      "The exact configured database must match --test-database.",
    );
  }
  const resolvedPath = await validateCredentialFilePath(parsed.credentialPath);

  const expected = expectedTestUserCredentials(
    parsed.roles,
    await isCustomerPasswordProviderEnabled(),
  );
  const existingManifest = await readCredentialFile(
    resolvedPath,
    parsed.databaseName,
    expected,
  );
  let credentials = existingManifest?.users;
  const preexisting = await existingUsers(parsed.roles);
  if (preexisting.length > 0) {
    if (preexisting.length !== parsed.roles.length || !credentials) {
      throw new Error(
        "Existing test accounts are partial or their private credentials are missing.",
      );
    }
    await seed("minimal");
    const [internal] = await db
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true))
      .limit(1);
    if (!internal) throw new Error("Internal test organisation is missing.");
    const [customerOrganisation] = await db
      .select()
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.id, CUSTOMER_ORGANISATION.id))
      .limit(1);
    if (parsed.roles.includes("customer"))
      assertCustomerOrganisation(customerOrganisation);
    await verifyExistingFixture(
      parsed.roles,
      credentials,
      "taskdesk-seed-minimal-workspace",
      internal.id,
    );
  } else {
    await seed("minimal");
    if (!credentials) {
      const manifest: TestUserCredentialManifest = {
        formatVersion: 1,
        targetDatabase: parsed.databaseName,
        users: expected.map((entry) => ({
          ...entry,
          password:
            entry.authentication === "local_password"
              ? generateTestUserPassword()
              : null,
        })),
      };
      credentials = manifest.users;
      await writeCredentialFile(resolvedPath, manifest);
    }
    try {
      await createFixture(parsed.roles, credentials);
    } catch {
      throw new Error(
        "Test-user fixture could not be created; no credentials were written to process output.",
      );
    }
  }
  return formatTestUserSeedResult(
    parsed.roles.length,
    parsed.databaseName,
    resolvedPath,
  );
}

export async function runTestUserSeedCli(
  configuredDatabaseName: string,
  args = process.argv.slice(2),
) {
  try {
    console.log(await seedTestUsers(configuredDatabaseName, args));
  } finally {
    await getDatabasePool().end();
  }
}

export function supportedRoleInventory() {
  return {
    canonical: [...BUILT_IN_ROLE_KEYS],
    supported: [...SUPPORTED_TEST_USER_ROLES],
    unavailable: BUILT_IN_ROLE_KEYS.filter(
      (role) => !SUPPORTED_TEST_USER_ROLES.includes(role as SupportedRole),
    ),
    workspaceDefaults: [...DEFAULT_ROLE_NAMES],
    planned: ["manager", "lead"],
  } as const;
}
