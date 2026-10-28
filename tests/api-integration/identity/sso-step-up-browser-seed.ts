import { createRequire } from "node:module";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { ensureStaffPersonForUser } from "../../../apps/api/src/utils/seed-internal-organisation";

const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const { eq } = apiRequire("drizzle-orm");
const { parseIdentityJitPolicy } = apiRequire("@taskdesk/domain");

const DATABASE_NAME = "taskdesk_codex_sso_browser_20261025_test";
const USER_ID = "sso-browser-admin";
const CONNECTION_ID = "sso-browser-identity-connection";
const EXTERNAL_IDENTITY_ID = "sso-browser-external-identity";
const SUBJECT = process.env.TASKDESK_TEST_OIDC_SUBJECT;
const JIT_POLICY = {
  enabled: false,
  default_role_id: null,
  required_entra_app_role: "TaskDesk.User",
};
const TENANT_ID = process.env.TASKDESK_TEST_OIDC_TENANT_ID;
const CLIENT_ID = process.env.TASKDESK_TEST_OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.TASKDESK_TEST_OIDC_CLIENT_SECRET;
const PROVIDER_REDIRECT_URI = process.env.TASKDESK_TEST_OIDC_REDIRECT_URI;
const AGENT_URL = process.env.TASKDESK_AGENT_URL;

async function seed() {
  // This must remain the first SQL statement: the private wrapper is scoped to this
  // synthetic database and a mistake must stop before any fixture writes occur.
  const [database] = (
    await getDatabasePool().query<{ name: string }>(
      "select current_database() as name",
    )
  ).rows;
  if (database?.name !== DATABASE_NAME)
    throw new Error("SSO browser seed refused unexpected database");

  const emptiness = await getDatabasePool().query<{
    users: string;
    persons: string;
    connections: string;
    identities: string;
    sessions: string;
    settings: string;
  }>(`
    select
      (select count(*)::text from public."user") as users,
      (select count(*)::text from public.person) as persons,
      (select count(*)::text from public.identity_connection) as connections,
      (select count(*)::text from public.external_identity) as identities,
      (select count(*)::text from public.session) as sessions,
      (select count(*)::text from public.instance_setting) as settings
  `);
  const empty = emptiness.rows[0];
  if (!empty || Object.values(empty).some((count) => count !== "0"))
    throw new Error("SSO browser seed refused a non-empty fixture database");

  if (
    !TENANT_ID ||
    !CLIENT_ID ||
    !CLIENT_SECRET ||
    !SUBJECT ||
    !PROVIDER_REDIRECT_URI ||
    !AGENT_URL
  )
    throw new Error("SSO browser seed configuration is incomplete");
  if (!parseIdentityJitPolicy(JIT_POLICY).ok)
    throw new Error("SSO browser fixture identity policy is invalid");

  const issuer = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
  const callback = new URL(
    `/api/auth/identity/${CONNECTION_ID}/callback`,
    AGENT_URL,
  ).toString();
  if (callback !== PROVIDER_REDIRECT_URI)
    throw new Error("SSO browser callback configuration is invalid");
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: USER_ID,
      name: "SSO Browser Fixture Administrator",
      email: "sso-browser-admin@example.test",
      role: "admin",
    })
    .returning({ id: schema.userTable.id });
  if (!user)
    throw new Error("SSO browser administrator fixture was not created");

  await db
    .insert(schema.instanceSettingTable)
    .values({ setupCompletedAt: new Date() })
    .onConflictDoNothing({ target: schema.instanceSettingTable.id });
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, USER_ID))
    .limit(1);
  if (!person) throw new Error("SSO browser staff person fixture is missing");

  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: "SSO Browser Fixture Connection",
    issuer,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: encryptIdentityClientSecret(CONNECTION_ID, CLIENT_SECRET),
    redirectUri: callback,
    scopes: ["openid", "profile", "email"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [],
    jitPolicy: JIT_POLICY,
    maxRoleRank: 5,
    mfaUpstreamMode: "off",
    enabled: true,
    createdBy: person.id,
    updatedBy: person.id,
  });

  await db.insert(schema.externalIdentityTable).values({
    id: EXTERNAL_IDENTITY_ID,
    identityConnectionId: CONNECTION_ID,
    personId: person.id,
    userId: USER_ID,
    issuer,
    subject: SUBJECT,
    userNameSnapshot: "sso-browser-admin",
    emailSnapshot: "sso-browser-admin@example.test",
    active: true,
    provisionedVia: "invite",
  });

  // Do not print fixture identifiers, database details, or provider configuration.
  console.info("SSO browser fixture seeded");
}

seed()
  .catch(() => {
    console.error("SSO browser fixture seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDatabasePool().end();
  });
