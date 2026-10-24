/**
 * P4 review round 2: R2-M1 (webhook.updated is written), R2-M2 (automation.created and
 * automation.updated are written, with before/after) and R2-M5 (an automation's effective role
 * must be a capability subset of its author, not only at or below the author's rank).
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  auditLogTable,
  personTable,
  webhookTable,
  workspaceFeatureFlagTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { updateWebhook } from "../../apps/api/src/webhook/repository";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { makeApiKey } from "./helpers/reach-world";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { createWorkspaceRoleNative } from "./helpers/workspace-role-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

type App = ReturnType<typeof createApp>["app"];

function call(
  app: App,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
) {
  return csrfRequest(
    app,
    path,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    cookie,
  );
}

async function world() {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const workspace = await createWorkspaceNative(app, owner.cookie, {
    name: "Audit",
  });
  const workspaceId = ((await workspace.json()) as { id: string }).id;
  await db.insert(workspaceFeatureFlagTable).values({
    workspaceId,
    featureKey: "feature.automations",
    enabled: true,
  });
  return { app, owner, workspaceId };
}

async function auditRows(entityId: string, action: string) {
  return db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entityId, entityId),
        eq(auditLogTable.action, action),
      ),
    )
    .orderBy(asc(auditLogTable.createdAt));
}

describe("R2-M1 webhook.updated", () => {
  it("records before/after of what changed, host only, never the secret", async () => {
    const { workspaceId } = await world();
    const [person] = await db.select().from(personTable).limit(1);
    if (!person) throw new Error("person row");
    const [hook] = await db
      .insert(webhookTable)
      .values({
        workspaceId,
        name: "Hook",
        url: "https://user:pw@old.example.com/path?token=abc",
        secret: "enc-secret-value",
        events: ["work_item.created"],
        createdBy: person.id,
      })
      .returning();
    if (!hook) throw new Error("webhook row");
    const actor = {
      userId: person.userId ?? "u",
      personId: person.id,
      actorType: "person" as const,
      apiKeyId: null,
    };
    await updateWebhook(
      hook.id,
      workspaceId,
      {
        url: "https://new.example.com/hook",
        events: ["work_item.created", "work_item.updated"],
        active: false,
      },
      actor,
    );
    const rows = await auditRows(hook.id, "webhook.updated");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.before).toMatchObject({
      urlHost: "old.example.com",
      active: true,
    });
    expect(row?.after).toMatchObject({
      urlHost: "new.example.com",
      active: false,
      events: ["work_item.created", "work_item.updated"],
    });
    // Unchanged fields are not repeated, and nothing sensitive is stored.
    expect(row?.after).not.toHaveProperty("name");
    const dump = JSON.stringify([row?.before, row?.after]);
    expect(dump).not.toContain("enc-secret-value");
    expect(dump).not.toContain("pw@");
    expect(dump).not.toContain("token=abc");

    // Resume writes a second row; a no-op patch writes none.
    await updateWebhook(hook.id, workspaceId, { active: true }, actor);
    await updateWebhook(hook.id, workspaceId, { name: "Hook" }, actor);
    expect(await auditRows(hook.id, "webhook.updated")).toHaveLength(2);

    // P4R3-L1: a same-host path/query change is audited, as a digest and never the URL.
    await updateWebhook(
      hook.id,
      workspaceId,
      { url: "https://new.example.com/other?token=zzz" },
      actor,
    );
    const afterPath = await auditRows(hook.id, "webhook.updated");
    expect(afterPath).toHaveLength(3);
    const last = afterPath[2] as (typeof afterPath)[number];
    const beforeDigest = (last.before as { urlDigest?: string }).urlDigest;
    const afterDigest = (last.after as { urlDigest?: string }).urlDigest;
    expect(beforeDigest).toMatch(/^[0-9a-f]{12}$/);
    expect(afterDigest).toMatch(/^[0-9a-f]{12}$/);
    expect(afterDigest).not.toBe(beforeDigest);
    expect(JSON.stringify([last.before, last.after])).not.toContain("zzz");
    // Re-sending the same URL stays a no-op.
    await updateWebhook(
      hook.id,
      workspaceId,
      { url: "https://new.example.com/other?token=zzz" },
      actor,
    );
    expect(await auditRows(hook.id, "webhook.updated")).toHaveLength(3);
  });
});

describe("R2-M2 automation.created and automation.updated", () => {
  it("writes both in the change's transaction with before/after", async () => {
    const { app, owner, workspaceId } = await world();
    const [adminRole] = await db
      .select()
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, workspaceId),
          eq(schema.roleTable.key, "admin"),
        ),
      );
    if (!adminRole) throw new Error("admin role row");
    const created = await call(
      app,
      owner.cookie,
      "POST",
      `/api/workspaces/${workspaceId}/automations`,
      {
        name: "Audited",
        trigger: "work_item.created",
        conditions: [],
        actions: [{ type: "set_priority", priority: "high" }],
        effectiveRoleId: adminRole.id,
      },
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const createdRows = await auditRows(id, "automation.created");
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]?.after).toMatchObject({
      name: "Audited",
      enabled: false,
      trigger: "work_item.created",
      effectiveRoleId: adminRole.id,
      actions: [{ type: "set_priority", priority: "high" }],
    });

    const enable = await call(
      app,
      owner.cookie,
      "POST",
      `/api/automations/${id}/enable`,
      {},
    );
    expect(enable.status).toBe(200);
    const edit = await call(
      app,
      owner.cookie,
      "PATCH",
      `/api/automations/${id}`,
      { actions: [{ type: "set_priority", priority: "urgent" }] },
    );
    expect(edit.status, await edit.clone().text()).toBe(200);
    const updated = await auditRows(id, "automation.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.before).toMatchObject({
      enabled: true,
      actions: [{ type: "set_priority", priority: "high" }],
    });
    expect(updated[0]?.after).toMatchObject({
      enabled: false,
      actions: [{ type: "set_priority", priority: "urgent" }],
    });
    expect(updated[0]?.after).not.toHaveProperty("name");
    expect(await auditRows(id, "automation.disabled")).toHaveLength(1);
  });
});

describe("R2-M5 effective role capability subset", () => {
  it("refuses a lower-ranked role that holds a capability the author lacks", async () => {
    const { app, owner, workspaceId } = await world();
    const mk = async (role: string, rank: number, capabilities: string[]) => {
      const res = await createWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        { role, rank, capabilities },
      );
      expect(res.status, await res.clone().text()).toBe(200);
    };
    await mk("Rulemaker", 60, ["workspace:manage_settings"]);
    await mk("Assigner", 40, ["work_item:assign"]);
    await mk("Plain", 40, ["work_item:read"]);
    const editor = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "rulemaker",
    );
    const roles = await db
      .select()
      .from(schema.roleTable)
      .where(eq(schema.roleTable.workspaceId, workspaceId));
    const byKey = (needle: string) => {
      const found = roles.find((r) => r.name === needle);
      if (!found) throw new Error(`role ${needle}`);
      return found;
    };
    const body = (roleId: string) => ({
      name: "Rule",
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "set_priority", priority: "high" }],
      effectiveRoleId: roleId,
    });
    const path = `/api/workspaces/${workspaceId}/automations`;

    const refused = await call(
      app,
      editor.cookie,
      "POST",
      path,
      body(byKey("Assigner").id),
    );
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(await refused.text()).toContain(
      "effective_role_exceeds_your_capabilities",
    );

    // Both lists exclude the role the editor could not have saved.
    const list = await app.request(path, {
      method: "GET",
      headers: { cookie: editor.cookie },
    });
    const listed = (
      (await list.json()) as { meta: { assignableRoles: { id: string }[] } }
    ).meta.assignableRoles.map((r) => r.id);
    expect(listed).not.toContain(byKey("Assigner").id);

    // The owner, who holds every capability, may use it.
    const ok = await call(
      app,
      owner.cookie,
      "POST",
      path,
      body(byKey("Assigner").id),
    );
    expect(ok.status, await ok.clone().text()).toBe(201);
    const { id } = (await ok.json()) as { id: string };

    // The editor may not enable, rewrite or dry-run it either.
    for (const [method, url, payload] of [
      ["POST", `/api/automations/${id}/enable`, {}],
      [
        "PATCH",
        `/api/automations/${id}`,
        { actions: [{ type: "set_priority", priority: "low" }] },
      ],
      ["POST", `/api/automations/${id}/dry-run`, undefined],
    ] as const) {
      const res = await call(app, editor.cookie, method, url, payload);
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });
});

describe("P4R3-M1 a narrow personal key cannot exceed its subset through a rule's role", () => {
  it("refuses an admin-role rule on create and enable, allows a role within the key's subset", async () => {
    const { app, owner, workspaceId } = await world();
    const roles = await db
      .select()
      .from(schema.roleTable)
      .where(eq(schema.roleTable.workspaceId, workspaceId));
    const admin = roles.find((r) => r.key === "admin");
    if (!admin) throw new Error("admin role row");
    const res = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "Reader",
        rank: 40,
        capabilities: ["work_item:read"],
      },
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const reader = (
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.workspaceId, workspaceId))
    ).find((r) => r.name === "Reader");
    if (!reader) throw new Error("reader role row");

    // A session rule with the admin role exists, ready to be enabled by the key.
    const body = (roleId: string) => ({
      name: "Rule",
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "set_priority", priority: "high" }],
      effectiveRoleId: roleId,
    });
    const path = `/api/workspaces/${workspaceId}/automations`;
    const made = await call(app, owner.cookie, "POST", path, body(admin.id));
    expect(made.status, await made.clone().text()).toBe(201);
    const adminRuleId = ((await made.json()) as { id: string }).id;

    const raw = await makeApiKey(owner.user.id, {
      workspace: ["manage_settings"],
      work_item: ["read"],
    });
    const keyCall = (method: string, url: string, payload?: unknown) =>
      app.request(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${raw}`,
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });

    const refusedCreate = await keyCall("POST", path, body(admin.id));
    expect(refusedCreate.status, await refusedCreate.clone().text()).toBe(403);
    expect(await refusedCreate.text()).toContain(
      "effective_role_exceeds_your_capabilities",
    );
    const refusedEnable = await keyCall(
      "POST",
      `/api/automations/${adminRuleId}/enable`,
      {},
    );
    expect(refusedEnable.status, await refusedEnable.clone().text()).toBe(403);
    const refusedDryRun = await keyCall(
      "POST",
      `/api/automations/${adminRuleId}/dry-run`,
    );
    expect(refusedDryRun.status).toBe(403);

    const allowed = await keyCall("POST", path, body(reader.id));
    expect(allowed.status, await allowed.clone().text()).toBe(201);
    const readerRuleId = ((await allowed.json()) as { id: string }).id;
    const enabled = await keyCall(
      "POST",
      `/api/automations/${readerRuleId}/enable`,
      {},
    );
    expect(enabled.status, await enabled.clone().text()).toBe(200);
  });
});
