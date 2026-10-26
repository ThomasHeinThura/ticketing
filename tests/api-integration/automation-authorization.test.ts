import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { workspaceFeatureFlagTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { projectKey } from "./helpers/project-key";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("project automation authorization", () => {
  it("allows a lead with automation:manage and denies a settings-only project role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceResponse = await createWorkspaceNative(app, owner.cookie, {
      name: "Automation authorization",
    });
    const workspaceId = ((await workspaceResponse.json()) as { id: string }).id;
    await db.insert(workspaceFeatureFlagTable).values({
      workspaceId,
      featureKey: "feature.automations",
      enabled: true,
    });
    const project = (
      await createProjectFixture({ workspaceId, slug: projectKey() })
    ).project;
    const [executionRole] = await db
      .select()
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, workspaceId),
          eq(schema.roleTable.key, "member"),
        ),
      );
    if (!executionRole) throw new Error("Expected workspace member role");
    const lead = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const leadRole = await grantProjectRole(lead.user.id, project.id, [
      ...(executionRole.capabilities as string[]),
      "project:read",
      "automation:manage",
      "work_item:set_priority",
    ]);
    await db
      .update(schema.roleTable)
      .set({ rank: executionRole.rank + 10 })
      .where(eq(schema.roleTable.id, leadRole.id));
    const settingsOnly = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    await grantProjectRole(settingsOnly.user.id, project.id, [
      "project:read",
      "project:manage_settings",
    ]);
    const path = `/api/projects/${project.slug}/automations`;
    const body = (effectiveRoleId: string) => ({
      name: "Project rule",
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "set_priority", priority: "high" }],
      effectiveRoleId,
    });
    const request = (cookie: string, effectiveRoleId: string) =>
      csrfRequest(
        app,
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify(body(effectiveRoleId)),
        },
        cookie,
      );

    const allowed = await request(lead.cookie, executionRole.id);
    expect(allowed.status, await allowed.clone().text()).toBe(201);

    const denied = await request(settingsOnly.cookie, executionRole.id);
    expect(denied.status, await denied.clone().text()).toBe(403);
  });
});
