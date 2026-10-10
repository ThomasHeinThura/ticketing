import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { createApp } from "../../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../../apps/api/src/utils/seed-internal-organisation";
import * as nativeAuthorization from "../../../apps/api/src/ws";
import { mockAuthenticatedSession } from "../helpers/auth";
import { csrfRequest } from "../helpers/csrf";
import { resetTestDatabase } from "../helpers/database";

const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

const ENCRYPTION_KEY = "d7".repeat(32);
const PASSWORD = "Jit-transition-password-71!";
const ADMIN_ID = "jit-transition-admin";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const CONNECTION_ID = "jit-transition-connection";
const W1 = "jit-transition-workspace-1";
const W2 = "jit-transition-workspace-2";
const R1 = "jit-transition-role-1";
const R2 = "jit-transition-role-2";
const R3 = "jit-transition-role-3";
const R_INSTANCE = "jit-transition-role-instance";
const R_UNKNOWN = "jit-transition-role-unknown";
const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;

async function setupAdmin() {
  const now = new Date();
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id: ADMIN_ID,
      name: "Identity Administrator",
      email: "identity-admin@example.test",
      role: "admin",
    })
    .returning();
  if (!admin) throw new Error("Identity administrator fixture was not created");
  await ensureStaffPersonForUser(admin.id);
  const [person] = await db
    .select({
      id: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, admin.id))
    .limit(1);
  if (!person) throw new Error("Identity administrator person was not created");
  mockAuthenticatedSession(admin);
  await db.insert(schema.sessionTable).values({
    id: `session-${admin.id}`,
    token: `token-${admin.id}`,
    userId: admin.id,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.accountTable).values({
    id: `account-${admin.id}`,
    accountId: admin.id,
    providerId: "credential",
    userId: admin.id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return {
    admin,
    person,
    sessionCookie: `__Host-tdk_agent_session=token-${admin.id}`,
  };
}

async function stepUp(
  app: ReturnType<typeof createApp>["app"],
  sessionCookie: string,
  binding: Record<string, unknown>,
) {
  const challengeResponse = await csrfRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(binding),
    },
    sessionCookie,
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proofResponse = await csrfRequest(
    app,
    "/api/me/step-up",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...binding,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        method: "password",
        password: PASSWORD,
      }),
    },
    sessionCookie,
  );
  expect(proofResponse.status).toBe(200);
  return (await proofResponse.json()) as { token: string };
}

async function seed(jit: { enabled: boolean; roleId: string | null }) {
  const { sessionCookie, person: adminPerson } = await setupAdmin();
  const internal = await ensureInternalOrganisation();
  await db.insert(schema.workspaceTable).values([
    {
      id: W1,
      organisationId: internal.id,
      name: "W1",
      slug: "jt-w1",
      createdAt: new Date(),
    },
    {
      id: W2,
      organisationId: internal.id,
      name: "W2",
      slug: "jt-w2",
      createdAt: new Date(),
    },
  ]);
  await db.insert(schema.roleTable).values([
    {
      id: R1,
      scope: "workspace",
      workspaceId: W1,
      key: "jt-r1",
      name: "R1",
      rank: 2,
      capabilities: [],
    },
    {
      id: R2,
      scope: "workspace",
      workspaceId: W1,
      key: "jt-r2",
      name: "R2",
      rank: 2,
      capabilities: [],
    },
    {
      id: R3,
      scope: "workspace",
      workspaceId: W2,
      key: "jt-r3",
      name: "R3",
      rank: 2,
      capabilities: [],
    },
    {
      id: R_INSTANCE,
      scope: "workspace",
      workspaceId: W1,
      key: "jt-instance",
      name: "Instance tier",
      rank: 2,
      capabilities: ["instance:read_audit"],
    },
    {
      id: R_UNKNOWN,
      scope: "workspace",
      workspaceId: W1,
      key: "jt-unknown",
      name: "Unknown capability",
      rank: 2,
      capabilities: ["not:a-capability"],
    },
  ]);
  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: W1,
    displayName: "JIT transition",
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(CONNECTION_ID, "stored-secret"),
    redirectUri: "http://localhost:1337/api/auth/identity/callback",
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [],
    jitPolicy: {
      enabled: jit.enabled,
      default_role_id: jit.roleId,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: 5,
    enabled: true,
    createdBy: adminPerson.id,
    updatedBy: adminPerson.id,
  });
  // A JIT-provisioned person with an active jit_default grant and its projection.
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: "jit-transition-user",
      name: "JIT",
      email: "jt@example.test",
    })
    .returning();
  const [person] = await db
    .insert(schema.personTable)
    .values({ userId: user?.id, organisationId: internal.id, side: "staff" })
    .returning();
  const [identity] = await db
    .insert(schema.externalIdentityTable)
    .values({
      identityConnectionId: CONNECTION_ID,
      personId: person?.id ?? "",
      userId: user?.id,
      issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
      subject: "jit-transition-subject",
      userNameSnapshot: "jt@example.test",
      emailSnapshot: "jt@example.test",
      active: true,
      provisionedVia: "jit",
    })
    .returning();
  const [membership] = await db
    .insert(schema.membershipTable)
    .values({
      personId: person?.id ?? "",
      scope: "workspace",
      scopeId: W1,
      roleId: R1,
      seesAll: false,
    })
    .returning();
  const [grant] = await db
    .insert(schema.membershipGrantTable)
    .values({
      membershipId: membership?.id,
      personId: person?.id ?? "",
      scope: "workspace",
      scopeId: W1,
      roleId: R1,
      sourceKind: "jit_default",
      externalIdentityId: identity?.id,
      identityConnectionId: CONNECTION_ID,
      seesAll: false,
    })
    .returning();
  if (!person || !grant) throw new Error("fixture missing");
  return { sessionCookie, personId: person.id, grantId: grant.id };
}

async function patch(sessionCookie: string, request: Record<string, unknown>) {
  const app = createApp().app;
  const [current] = await db
    .select({ v: schema.identityConnectionTable.configVersion })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
  const body = { configVersion: current?.v ?? 1, ...request };
  const proof = await stepUp(app, sessionCookie, {
    kind: "operation",
    operation: "identity_connection_configure",
    connectionId: CONNECTION_ID,
    request: body,
  });
  return csrfRequest(
    app,
    `/api/instance/identity-connections/${CONNECTION_ID}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-taskdesk-step-up-token": proof.token,
      },
      body: JSON.stringify(body),
    },
    sessionCookie,
  );
}

async function state(grantId: string, personId: string) {
  const [grant] = await db
    .select()
    .from(schema.membershipGrantTable)
    .where(eq(schema.membershipGrantTable.id, grantId));
  const memberships = await db
    .select()
    .from(schema.membershipTable)
    .where(eq(schema.membershipTable.personId, personId));
  return { grant, memberships };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  vi.spyOn(
    nativeAuthorization,
    "invalidateNativeAuthorization",
  ).mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalEncryptionKey;
});

describe("IP-22 JIT policy transitions through the connection configure path", () => {
  const enabledJit = { enabled: true, roleId: R1 };
  const policy = (enabled: boolean, roleId: string | null) => ({
    enabled,
    default_role_id: roleId,
    required_entra_app_role: "TaskDesk.User",
  });

  it("retires the connection's jit_default grants and reprojects when JIT is turned off", async () => {
    const { sessionCookie, personId, grantId } = await seed(enabledJit);
    const response = await patch(sessionCookie, {
      jitPolicy: policy(false, R1),
    });
    expect(response.status).toBe(200);
    const after = await state(grantId, personId);
    expect(after.grant?.revokedAt).toBeInstanceOf(Date);
    expect(after.grant?.revocationReason).toBe("mapping_changed");
    expect(after.memberships).toHaveLength(0);
  });

  it("retires the old jit_default grants when the default role changes", async () => {
    const { sessionCookie, personId, grantId } = await seed(enabledJit);
    const response = await patch(sessionCookie, {
      jitPolicy: policy(true, R2),
    });
    expect(response.status).toBe(200);
    const after = await state(grantId, personId);
    expect(after.grant?.revokedAt).toBeInstanceOf(Date);
    expect(after.grant?.revocationReason).toBe("mapping_changed");
    expect(after.memberships).toHaveLength(0);
  });

  it("retires the old jit_default grants when the default workspace changes", async () => {
    // JIT is off, so the new target needs no default role; a stale grant still exists.
    const { sessionCookie, personId, grantId } = await seed({
      enabled: false,
      roleId: null,
    });
    const response = await patch(sessionCookie, { defaultWorkspaceId: W2 });
    expect(response.status).toBe(200);
    const after = await state(grantId, personId);
    expect(after.grant?.revokedAt).toBeInstanceOf(Date);
    expect(after.grant?.revocationReason).toBe("mapping_changed");
    expect(after.memberships).toHaveLength(0);
  });

  it("leaves the grant and projection alone for an unrelated configuration change", async () => {
    const { sessionCookie, personId, grantId } = await seed(enabledJit);
    const response = await patch(sessionCookie, { displayName: "Renamed" });
    expect(response.status).toBe(200);
    const after = await state(grantId, personId);
    expect(after.grant?.revokedAt).toBeNull();
    expect(after.memberships).toHaveLength(1);
  });

  it("refuses to save a default role the shared IdP role predicate rejects", async () => {
    const { sessionCookie, grantId, personId } = await seed(enabledJit);
    for (const roleId of [R_INSTANCE, R_UNKNOWN]) {
      const response = await patch(sessionCookie, {
        jitPolicy: policy(true, roleId),
      });
      expect(response.status).toBe(422);
    }
    const [stored] = await db
      .select({ jitPolicy: schema.identityConnectionTable.jitPolicy })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(stored?.jitPolicy).toMatchObject({ default_role_id: R1 });
    const after = await state(grantId, personId);
    expect(after.grant?.revokedAt).toBeNull();
  });

  it("treats an unreadable stored policy as a change and retires the JIT grants", async () => {
    const { sessionCookie, personId, grantId } = await seed(enabledJit);
    await db
      .update(schema.identityConnectionTable)
      .set({ jitPolicy: { corrupt: true } })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    const response = await patch(sessionCookie, {
      jitPolicy: policy(true, R2),
    });
    expect(response.status).toBe(200);
    const after = await state(grantId, personId);
    expect(after.grant?.revokedAt).toBeInstanceOf(Date);
    expect(after.grant?.revocationReason).toBe("mapping_changed");
    expect(after.memberships).toHaveLength(0);
  });
});
