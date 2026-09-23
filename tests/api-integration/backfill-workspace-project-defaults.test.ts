/**
 * Issue #316: backfill the default `work_item_type`/`state_template`/`state` rows for
 * workspaces and projects created BEFORE #309/#313 taught `create-workspace.ts` and
 * `create-project.ts` to seed them in their own creating transaction.
 *
 * `createWorkspaceMember`/`createProjectFixture` (`./helpers/fixtures.ts`) insert their
 * rows directly, exactly the way every workspace/project in the database was created
 * before #313 -- neither one calls `seedWorkspaceDefaults`/`seedProjectStates`. That is
 * this file's "legacy" fixture: real rows with none of #313's seeded rows, the same shape
 * `POST /api/projects/{projectId}/work-items` fails against on an un-backfilled instance.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { backfillWorkspaceAndProjectDefaults } from "../../apps/api/src/utils/backfill-workspace-project-defaults";
import { DEFAULT_STATE_TEMPLATES } from "../../apps/api/src/utils/default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "../../apps/api/src/utils/default-work-item-types";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: backfill legacy workspace/project defaults (#316)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("backfills a legacy workspace's types/templates and a legacy project's states, and work-item creation then succeeds", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    // Pre-backfill: exactly the failure #316 exists to fix.
    const typesBefore = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(typesBefore).toHaveLength(0);
    const statesBefore = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(statesBefore).toHaveLength(0);

    await backfillWorkspaceAndProjectDefaults();

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(types).toHaveLength(DEFAULT_WORK_ITEM_TYPES.length);
    expect(new Set(types.map((t) => t.key))).toEqual(
      new Set(DEFAULT_WORK_ITEM_TYPES.map((t) => t.key)),
    );

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(DEFAULT_STATE_TEMPLATES.length);

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(DEFAULT_STATE_TEMPLATES.length);
    const defaults = states.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);

    const taskType = types.find((t) => t.key === "task");
    expect(taskType).toBeTruthy();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await createWorkItemRequest(app, project.id, {
      typeId: taskType?.id,
      title: "Printer is on fire",
    });
    expect(response.status).toBe(200);
    const workItem = (await response.json()) as {
      key: string;
      stateId: string;
    };
    expect(workItem.key).toBe(`${project.slug}-1`);
    expect(workItem.stateId).toBe(defaults[0]?.id);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await backfillWorkspaceAndProjectDefaults();

    const typesBefore = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    const templatesBefore = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    const statesBefore = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });

    await backfillWorkspaceAndProjectDefaults();

    const typesAfter = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    const templatesAfter = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    const statesAfter = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });

    expect(new Set(typesAfter.map((t) => t.id))).toEqual(
      new Set(typesBefore.map((t) => t.id)),
    );
    expect(new Set(templatesAfter.map((t) => t.id))).toEqual(
      new Set(templatesBefore.map((t) => t.id)),
    );
    expect(new Set(statesAfter.map((s) => s.id))).toEqual(
      new Set(statesBefore.map((s) => s.id)),
    );
    expect(statesAfter.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("never touches a workspace that already has its own work_item_type row", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    const [customType] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: "custom-triage",
        name: "Triage",
        category: "service",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(customType).toBeTruthy();

    await backfillWorkspaceAndProjectDefaults();

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    // Untouched: still exactly the operator's one custom type, none of the 9
    // defaults added alongside it.
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("custom-triage");

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(0);
  });

  it("never touches a workspace that already has its own state_template row", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    const [customTemplate] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: member.workspace.id,
        key: "custom-triaging",
        name: "Triaging",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(customTemplate).toBeTruthy();

    await backfillWorkspaceAndProjectDefaults();

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]?.key).toBe("custom-triaging");

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(types).toHaveLength(0);
  });

  it("never touches a project that already has its own state row", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const now = new Date();
    const [customTemplate] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: member.workspace.id,
        key: "custom-state",
        name: "Custom",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!customTemplate) throw new Error("insert returned no row");

    const [customState] = await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: customTemplate.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(customState).toBeTruthy();

    await backfillWorkspaceAndProjectDefaults();

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    // Untouched: still exactly the operator's one custom state. The workspace itself
    // had no types/templates of its own, so it DOES get backfilled -- only the
    // already-stated project is left alone.
    expect(states).toHaveLength(1);
    expect(states[0]?.id).toBe(customState?.id);
  });

  it("a concurrent backfill run does not double-seed a legacy project's states", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    // Backfill the workspace itself first, so both concurrent runs below are racing
    // only on the PROJECT's state seeding -- the thing #313's Opus review (S2) flagged
    // as unsafe outside the creator's own advisory lock.
    await backfillWorkspaceAndProjectDefaults();
    const templatesBefore = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    await db
      .delete(schema.stateTable)
      .where(eq(schema.stateTable.projectId, project.id));

    await Promise.all(
      Array.from({ length: 30 }, () => backfillWorkspaceAndProjectDefaults()),
    );

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(templatesBefore.length);
    expect(states.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("skips a soft-deleted legacy project", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    await backfillWorkspaceAndProjectDefaults();

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(0);
  });
});
