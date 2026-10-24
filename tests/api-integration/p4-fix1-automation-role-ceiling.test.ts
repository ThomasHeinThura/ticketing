/**
 * P4 review M2 (AM-3): the effective-role rank ceiling applies to every act that decides what a
 * rule does as that role: not only choosing the role, but rewriting the rule, enabling it and
 * dry-running it. An editor below the stored role's rank is refused each time; disabling, which
 * only reduces what runs, stays open.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  automationTable,
  workspaceFeatureFlagTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
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
    name: "Rules",
  });
  const workspaceId = ((await workspace.json()) as { id: string }).id;
  await db.insert(workspaceFeatureFlagTable).values({
    workspaceId,
    featureKey: "feature.automations",
    enabled: true,
  });
  // A custom editor ranked below the built-in admin role the rule will run as.
  const editorRole = await createWorkspaceRoleNative(
    app,
    owner.cookie,
    workspaceId,
    {
      role: "Rulemaker",
      rank: 40,
      capabilities: ["workspace:manage_settings"],
    },
  );
  expect(editorRole.status, await editorRole.clone().text()).toBe(200);
  const editor = await inviteAndAcceptAsNewMemberNative(
    app,
    owner.cookie,
    workspaceId,
    "rulemaker",
  );
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
  expect(adminRole.rank).toBeGreaterThan(40);
  const rule = await call(
    app,
    owner.cookie,
    "POST",
    `/api/workspaces/${workspaceId}/automations`,
    {
      name: "Runs as admin",
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "set_priority", priority: "high" }],
      effectiveRoleId: adminRole.id,
    },
  );
  expect(rule.status, await rule.clone().text()).toBe(201);
  const created = (await rule.json()) as { id: string; version: number };
  return { app, owner, editor, workspaceId, ruleId: created.id };
}

describe("effective role ceiling on edit, enable and dry-run (M2)", () => {
  it("refuses an editor below the stored role on every behaviour-changing call", async () => {
    const { app, owner, editor, ruleId } = await world();
    const rewrite = await call(
      app,
      editor.cookie,
      "PATCH",
      `/api/automations/${ruleId}`,
      { actions: [{ type: "set_priority", priority: "urgent" }] },
    );
    expect(rewrite.status, await rewrite.clone().text()).toBe(403);
    expect(await rewrite.text()).toContain("effective_role_above_your_rank");

    const toggle = await call(
      app,
      editor.cookie,
      "PATCH",
      `/api/automations/${ruleId}`,
      { stopProcessing: true },
    );
    expect(toggle.status, await toggle.clone().text()).toBe(403);

    const enable = await call(
      app,
      editor.cookie,
      "POST",
      `/api/automations/${ruleId}/enable`,
      {},
    );
    expect(enable.status, await enable.clone().text()).toBe(403);
    expect(await enable.text()).toContain("effective_role_above_your_rank");

    const dryRun = await call(
      app,
      editor.cookie,
      "POST",
      `/api/automations/${ruleId}/dry-run`,
    );
    expect(dryRun.status, await dryRun.clone().text()).toBe(403);

    // Nothing the editor tried changed the stored rule.
    const [stored] = await db
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, ruleId));
    expect(stored?.enabled).toBe(false);
    expect(stored?.actions).toEqual([
      { type: "set_priority", priority: "high" },
    ]);

    // The owner, above the role's rank, may.
    const ownerEdit = await call(
      app,
      owner.cookie,
      "PATCH",
      `/api/automations/${ruleId}`,
      { actions: [{ type: "set_priority", priority: "urgent" }] },
    );
    expect(ownerEdit.status, await ownerEdit.clone().text()).toBe(200);
    const ownerEnable = await call(
      app,
      owner.cookie,
      "POST",
      `/api/automations/${ruleId}/enable`,
      {},
    );
    expect(ownerEnable.status, await ownerEnable.clone().text()).toBe(200);

    // Disabling only reduces what runs, so the lower editor may still do it.
    const disable = await call(
      app,
      editor.cookie,
      "POST",
      `/api/automations/${ruleId}/disable`,
      {},
    );
    expect(disable.status, await disable.clone().text()).toBe(200);
  });
});
