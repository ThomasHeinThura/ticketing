import { and, eq, isNull } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

const ENCRYPTION_KEY = "ab".repeat(32);
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

async function connection(connectionId: string, token: string) {
  await ensureInternalOrganisation();
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: `SCIM ${connectionId}`,
    issuer: "https://login.microsoftonline.com/tenant/v2.0",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: encryptIdentityClientSecret(connectionId, "fixture"),
    redirectUri: "http://localhost:1337/api/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
    maxRoleRank: 10,
    enabled: true,
  });
  await db.insert(schema.scimConnectionTable).values({
    identityConnectionId: connectionId,
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 8),
    tokenCreatedAt: new Date(),
    allowedResources: ["users", "groups"],
    enabled: true,
  });
}

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/scim+json",
});

let app: ReturnType<typeof createApp>["app"];
const TOKEN = "S".repeat(43);
const CONNECTION = "p3r1-scim-connection";

async function createUser(
  externalId: string,
  email: string,
  token = TOKEN,
): Promise<string> {
  const response = await app.request("/scim/v2/Users", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      schemas: [USER_SCHEMA],
      externalId,
      userName: email,
      displayName: externalId,
      emails: [{ value: email, primary: true }],
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.scim", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  await connection(CONNECTION, TOKEN);
  app = createApp().app;
  app.onError((e, c) => {
    return c.json({ message: e instanceof Error ? e.stack : String(e) }, 500);
  });
});

async function deniedEvents() {
  const rows = await db
    .select({ detail: schema.provisioningEventTable.detail })
    .from(schema.provisioningEventTable)
    .where(
      and(
        eq(schema.provisioningEventTable.kind, "request.denied"),
        eq(schema.provisioningEventTable.identityConnectionId, CONNECTION),
      ),
    );
  return rows.filter(
    (row) =>
      (row.detail as { reason?: string } | null)?.reason ===
      "forbidden_attribute",
  );
}

describe("P3-R1-06 forbidden attributes on POST and PUT /Users (IP-4)", () => {
  for (const attribute of [
    { organisation_id: "other-org" },
    { workspaceId: "other-workspace" },
    { role: "admin" },
    { portalScope: "customer" },
  ]) {
    it(`POST refuses ${Object.keys(attribute)[0]} with 400 forbidden_attribute and a provisioning event`, async () => {
      const response = await app.request("/scim/v2/Users", {
        method: "POST",
        headers: headers(TOKEN),
        body: JSON.stringify({
          schemas: [USER_SCHEMA],
          externalId: "forbidden-post",
          userName: "forbidden-post@example.test",
          emails: [{ value: "forbidden-post@example.test", primary: true }],
          ...attribute,
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        scimType: "forbidden_attribute",
      });
      expect(await deniedEvents()).toHaveLength(1);
      const created = await db
        .select({ id: schema.externalIdentityTable.id })
        .from(schema.externalIdentityTable)
        .where(
          eq(schema.externalIdentityTable.scimExternalId, "forbidden-post"),
        );
      expect(created).toHaveLength(0);
    });
  }

  it("PUT refuses a forbidden attribute the same way and leaves the user unchanged", async () => {
    const id = await createUser("put-user", "put-user@example.test");
    const response = await app.request(`/scim/v2/Users/${id}`, {
      method: "PUT",
      headers: headers(TOKEN),
      body: JSON.stringify({
        schemas: [USER_SCHEMA],
        externalId: "put-user",
        userName: "put-user@example.test",
        emails: [{ value: "put-user@example.test", primary: true }],
        organisationId: "other-org",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      scimType: "forbidden_attribute",
    });
    expect(await deniedEvents()).toHaveLength(1);
  });
});

describe("P3-R1-07 PATCH /Users email change runs the cross-organisation conflict check", () => {
  // A PATCH changes the address through the configured profile source; `userName` is the
  // patchable one (the default `emails` source is replaced through PUT).
  beforeEach(async () => {
    await db
      .update(schema.scimConnectionTable)
      .set({
        attributeMapping: {
          version: 1,
          name: "displayName",
          email: "userName",
          jobTitle: "title",
          locale: "preferredLanguage",
        },
      })
      .where(eq(schema.scimConnectionTable.identityConnectionId, CONNECTION));
  });

  it("returns 409 uniqueness when the new address belongs to another connection's identity", async () => {
    const otherToken = "O".repeat(43);
    await connection("p3r1-scim-other", otherToken);
    await createUser("foreign", "taken@example.test", otherToken);
    const id = await createUser("mover", "mover@example.test");
    const response = await app.request(`/scim/v2/Users/${id}`, {
      method: "PATCH",
      headers: headers(TOKEN),
      body: JSON.stringify({
        schemas: [PATCH_SCHEMA],
        Operations: [
          { op: "replace", path: "userName", value: "taken@example.test" },
        ],
      }),
    });
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ scimType: "uniqueness" });
    const [row] = await db
      .select({ email: schema.externalIdentityTable.emailSnapshot })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, id));
    expect(row?.email).toBe("mover@example.test");
  });

  it("still applies a non-conflicting email change", async () => {
    const id = await createUser("mover-3", "mover-3@example.test");
    const response = await app.request(`/scim/v2/Users/${id}`, {
      method: "PATCH",
      headers: headers(TOKEN),
      body: JSON.stringify({
        schemas: [PATCH_SCHEMA],
        Operations: [
          { op: "replace", path: "userName", value: "fresh@example.test" },
        ],
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [row] = await db
      .select({ email: schema.externalIdentityTable.emailSnapshot })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, id));
    expect(row?.email).toBe("fresh@example.test");
  });
});

describe("P3-R1-05 concurrent group PATCH is serialised on the group row", () => {
  it("applies remove-M and add-N together and keeps M's mapped grant retired", async () => {
    const internalOrg = await ensureInternalOrganisation();
    await db.insert(schema.workspaceTable).values({
      id: "p3r1-group-workspace",
      organisationId: internalOrg.id,
      name: "Group workspace",
      slug: "p3r1-group-workspace",
      createdAt: new Date(),
    });
    await db.insert(schema.roleTable).values({
      id: "p3r1-group-role",
      scope: "workspace",
      workspaceId: "p3r1-group-workspace",
      key: "p3r1-group-role",
      name: "Group role",
      rank: 2,
      capabilities: [],
    });
    await db.insert(schema.scimGroupMappingTable).values({
      id: "p3r1-group-mapping",
      scimConnectionId: CONNECTION,
      externalGroupId: "p3r1-team",
      roleId: "p3r1-group-role",
      scope: "workspace",
      scopeId: "p3r1-group-workspace",
    });
    const memberM = await createUser("member-m", "m@example.test");
    const memberN = await createUser("member-n", "n@example.test");
    const created = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        schemas: [GROUP_SCHEMA],
        externalId: "p3r1-team",
        displayName: "Team",
        members: [{ value: memberM, type: "User" }],
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const groupId = ((await created.json()) as { id: string }).id;

    const activeGrants = async (identityId: string) =>
      db
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable)
        .where(
          and(
            eq(schema.membershipGrantTable.externalIdentityId, identityId),
            isNull(schema.membershipGrantTable.revokedAt),
          ),
        );
    expect(await activeGrants(memberM)).toHaveLength(1);

    // Hold the group row so both PATCHes read the same pre-image and then queue behind the lock.
    const holder = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await holder.connect();
    await observer.connect();
    try {
      await holder.query("BEGIN");
      const pid = Number(
        (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );
      await holder.query("SELECT id FROM scim_group WHERE id = $1 FOR UPDATE", [
        groupId,
      ]);
      const patch = (operations: unknown[]) =>
        app.request(`/scim/v2/Groups/${groupId}`, {
          method: "PATCH",
          headers: headers(TOKEN),
          body: JSON.stringify({
            schemas: [PATCH_SCHEMA],
            Operations: operations,
          }),
        });
      const removeM = patch([
        { op: "remove", path: `members[value eq "${memberM}"]` },
      ]);
      const addN = patch([
        {
          op: "add",
          path: "members",
          value: [{ value: memberN, type: "User" }],
        },
      ]);
      const deadline = Date.now() + 10_000;
      for (;;) {
        // The first PATCH waits on the held row; the second may wait behind the first (the
        // pending-action lifecycle advisory lock is taken first), so count every lock waiter
        // in the chain that the holder ultimately blocks.
        const waiting = await observer.query<{ waiting: string }>(
          `SELECT count(*)::text AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND cardinality(pg_blocking_pids(pid)) > 0
             AND pid <> $1`,
          [pid],
        );
        if (Number(waiting.rows[0]?.waiting ?? 0) >= 2) break;
        if (Date.now() > deadline) throw new Error("PATCHes did not queue");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await holder.query("COMMIT");
      const [first, second] = await Promise.all([removeM, addN]);
      expect(first.status, await first.clone().text()).toBe(200);
      expect(second.status, await second.clone().text()).toBe(200);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
      await observer.end();
    }

    const finalGroup = await app.request(`/scim/v2/Groups/${groupId}`, {
      headers: headers(TOKEN),
    });
    const members = (
      (await finalGroup.json()) as {
        members: Array<{ value: string }>;
      }
    ).members.map((member) => member.value);
    expect(members).toEqual([memberN]);
    expect(await activeGrants(memberM)).toHaveLength(0);
    expect(await activeGrants(memberN)).toHaveLength(1);
  });
});
