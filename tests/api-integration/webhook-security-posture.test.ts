/** WH-15: the mounted security-posture read is current-admin-only and secret-free. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const AGENT_HOST = new URL(getConfiguredAgentOrigin()).host;
const CUSTOMER_HOST = new URL(getConfiguredCustomerOrigin()).host;
const SECRET = "whsec_posture_test_secret_000000000000";

async function createWebhook(workspaceId: string, ownerUserId: string) {
  const owner = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, ownerUserId))
      .limit(1),
    "webhook owner person",
  );
  const marker = randomUUID();
  const row = requireRow(
    await db
      .insert(webhookTable)
      .values({
        workspaceId,
        name: `Posture ${marker}`,
        url: `https://hooks.example.test/${marker}`,
        secret: encryptSecret(SECRET + marker) as string,
        events: ["work_item.created"],
        createdBy: owner.id,
      })
      .returning(),
    "webhook",
  );
  return { row, marker };
}

function request(path: string, headers: Record<string, string> = {}) {
  const { app } = createApp();
  return app.request(path, { headers: { host: AGENT_HOST, ...headers } });
}

describe("GET /api/instance/webhooks/security-posture", () => {
  beforeEach(async () => resetTestDatabase());

  it("paginates current full-reach owners only and omits URLs, secrets, and bodies", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const ordinary = await createWorkspaceMember({ role: "owner" });
    const seesAll = await createWorkspaceMember({ role: "owner" });
    const [seesAllPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, seesAll.user.id))
      .limit(1);
    if (!seesAllPerson)
      throw new Error("sees_all webhook owner person missing");
    const seesAllRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: seesAll.workspace.id,
          key: `posture-sees-all-${randomUUID()}`,
          name: "Posture sees all",
          rank: 1,
          capabilities: ["workspace:read"],
        })
        .returning(),
      "sees_all role",
    );
    await db.insert(schema.membershipTable).values({
      personId: seesAllPerson.id,
      scope: "workspace",
      scopeId: seesAll.workspace.id,
      roleId: seesAllRole.id,
      seesAll: true,
    });
    const inactiveAdmin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, inactiveAdmin.user.id));
    const [inactivePerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, inactiveAdmin.user.id))
      .limit(1);
    if (!inactivePerson)
      throw new Error("Inactive webhook owner person missing");
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, inactivePerson.id));

    const expected = [
      await createWebhook(admin.workspace.id, admin.user.id),
      await createWebhook(admin.workspace.id, admin.user.id),
      await createWebhook(admin.workspace.id, admin.user.id),
      await createWebhook(seesAll.workspace.id, seesAll.user.id),
    ];
    const notFullReach = await createWebhook(
      ordinary.workspace.id,
      ordinary.user.id,
    );
    const inactive = await createWebhook(
      inactiveAdmin.workspace.id,
      inactiveAdmin.user.id,
    );

    mockAuthenticatedSession({ ...admin.user, role: "admin" });
    const collected: { id: string; ownerPersonId: string }[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "2" });
      if (cursor) query.set("cursor", cursor);
      const response = await request(
        `/api/instance/webhooks/security-posture?${query.toString()}`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const text = await response.text();
      for (const marker of [
        ...expected.map(({ marker }) => marker),
        notFullReach.marker,
        inactive.marker,
      ]) {
        expect(text).not.toContain(`https://hooks.example.test/${marker}`);
        expect(text).not.toContain(SECRET + marker);
      }
      const body = JSON.parse(text) as {
        data: { id: string; ownerPersonId: string }[];
        page: { nextCursor: string | null; hasMore: boolean };
      };
      collected.push(...body.data);
      cursor = body.page.nextCursor ?? undefined;
      if (!body.page.hasMore) expect(cursor).toBeUndefined();
    } while (cursor);

    expect(collected.map(({ id }) => id).sort()).toEqual(
      expected.map(({ row }) => row.id).sort(),
    );
    expect(new Set(collected.map(({ id }) => id)).size).toBe(collected.length);
    expect(
      collected.every(({ ownerPersonId }) => ownerPersonId.length > 0),
    ).toBe(true);
  });

  it("denies ordinary sessions, API keys, and customer-host sessions", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const ordinary = await createWorkspaceMember({ role: "owner" });

    mockAuthenticatedSession({ ...ordinary.user, role: null });
    expect(
      (await request("/api/instance/webhooks/security-posture")).status,
    ).toBe(403);

    const apiKey = await createPersonalApiKey(
      { userId: admin.user.id },
      { name: "Posture test key" },
    );
    expect(
      (
        await request("/api/instance/webhooks/security-posture", {
          "x-api-key": apiKey.key,
        })
      ).status,
    ).toBe(403);

    mockAuthenticatedSession(
      { ...admin.user, role: "admin" },
      { portal: "customer" },
    );
    const { app } = createApp();
    expect(
      (
        await app.request("/api/instance/webhooks/security-posture", {
          headers: { host: CUSTOMER_HOST },
        })
      ).status,
    ).toBe(404);
  });
});
