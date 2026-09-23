/**
 * Issue #309 (PR-17): a fresh workspace and a fresh project seed the default
 * `work_item_type` / `state_template` / `state` rows they need, in the SAME transaction
 * as their own creation -- without any fixture SQL, `POST
 * /api/projects/{projectId}/work-items` succeeds on a genuinely fresh instance.
 *
 * Drives the REAL routes end-to-end (`POST /api/workspace`, `POST /api/project`,
 * `POST /api/projects/{projectId}/work-items`) rather than the `createWorkspaceMember`/
 * `createProjectFixture` helpers, which insert rows directly and therefore bypass the
 * very seeding hooks this file exists to prove.
 */
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { DEFAULT_STATE_TEMPLATES } from "../../apps/api/src/utils/default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "../../apps/api/src/utils/default-work-item-types";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

async function createProjectNative(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  body: { workspaceId: string; name: string; icon: string; slug: string },
): Promise<Response> {
  return app.request("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("API integration: workspace/project default seeding (#309)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("seeds the default work item types and state templates for a fresh workspace", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, workspace.id),
    });
    expect(types).toHaveLength(DEFAULT_WORK_ITEM_TYPES.length);
    expect(new Set(types.map((t) => t.key))).toEqual(
      new Set(DEFAULT_WORK_ITEM_TYPES.map((t) => t.key)),
    );
    for (const expected of DEFAULT_WORK_ITEM_TYPES) {
      const row = types.find((t) => t.key === expected.key);
      expect(row).toMatchObject({
        name: expected.name,
        category: expected.category,
        isEpic: expected.isEpic ?? false,
        isChange: expected.isChange ?? false,
      });
      // Issue #309's own dependency question: no `workflow` table exists yet
      // (P2/P5 scope) -- a seeded type carries no workflow to point at.
      expect(row?.workflowId).toBeNull();
    }

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, workspace.id),
    });
    expect(templates).toHaveLength(DEFAULT_STATE_TEMPLATES.length);
    expect(new Set(templates.map((t) => t.key))).toEqual(
      new Set(DEFAULT_STATE_TEMPLATES.map((t) => t.key)),
    );
    for (const expected of DEFAULT_STATE_TEMPLATES) {
      const row = templates.find((t) => t.key === expected.key);
      expect(row).toMatchObject({ name: expected.name, group: expected.group });
    }
  });

  it("seeds a fresh project's concrete states from the workspace templates, with exactly one default, and a work item can then be created with no fixture SQL", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const workspaceResponse = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(workspaceResponse.status).toBe(200);
    const workspace = (await workspaceResponse.json()) as { id: string };

    const projectResponse = await createProjectNative(app, owner.cookie, {
      workspaceId: workspace.id,
      name: "Support",
      icon: "Folder",
      slug: "support",
    });
    expect(projectResponse.status).toBe(200);
    const project = (await projectResponse.json()) as {
      id: string;
      slug: string;
    };

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(DEFAULT_STATE_TEMPLATES.length);

    const defaults = states.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);

    const defaultTemplate = await db.query.stateTemplateTable.findFirst({
      where: eq(
        schema.stateTemplateTable.id,
        defaults[0]?.stateTemplateId ?? "",
      ),
    });
    expect(defaultTemplate?.group).toBe("unstarted");

    // No fixture SQL from here: the type comes from the workspace's own seeded rows.
    const type = await db.query.workItemTypeTable.findFirst({
      where: and(
        eq(schema.workItemTypeTable.workspaceId, workspace.id),
        eq(schema.workItemTypeTable.key, "task"),
      ),
    });
    expect(type).toBeTruthy();

    const workItemResponse = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          typeId: type?.id,
          title: "Printer is on fire",
        }),
      },
    );
    expect(workItemResponse.status).toBe(200);
    const workItem = (await workItemResponse.json()) as {
      key: string;
      stateId: string;
      typeId: string;
    };
    expect(workItem.key).toBe(`${project.slug}-1`);
    expect(workItem.typeId).toBe(type?.id);
    expect(workItem.stateId).toBe(defaults[0]?.id);
  });

  it("is idempotent: seeding the same workspace or project twice never double-seeds", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const workspaceResponse = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    const workspace = (await workspaceResponse.json()) as { id: string };

    const projectResponse = await createProjectNative(app, owner.cookie, {
      workspaceId: workspace.id,
      name: "Support",
      icon: "Folder",
      slug: "support",
    });
    const project = (await projectResponse.json()) as { id: string };

    const typesBefore = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, workspace.id),
    });
    const templatesBefore = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, workspace.id),
    });
    const statesBefore = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });

    // Re-invoke the seed functions directly for the SAME workspace/project -- the
    // real create routes only ever run them once each, so this exercises the guard
    // itself rather than a route that cannot actually trigger it twice.
    await seedWorkspaceDefaults(workspace.id);
    await seedProjectStates(project.id, workspace.id);

    const typesAfter = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, workspace.id),
    });
    const templatesAfter = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, workspace.id),
    });
    const statesAfter = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });

    expect(typesAfter).toHaveLength(typesBefore.length);
    expect(templatesAfter).toHaveLength(templatesBefore.length);
    expect(statesAfter).toHaveLength(statesBefore.length);
    expect(statesAfter.filter((s) => s.isDefault)).toHaveLength(1);
    expect(new Set(typesAfter.map((t) => t.id))).toEqual(
      new Set(typesBefore.map((t) => t.id)),
    );
    expect(new Set(templatesAfter.map((t) => t.id))).toEqual(
      new Set(templatesBefore.map((t) => t.id)),
    );
    expect(new Set(statesAfter.map((s) => s.id))).toEqual(
      new Set(statesBefore.map((s) => s.id)),
    );
  });

  it("never leaves a project with more than one default state, even with pre-existing archived templates", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const workspaceResponse = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    const workspace = (await workspaceResponse.json()) as { id: string };

    // Archive one workspace template before the project is created -- an archived
    // template is "hidden from the picker ... still referenceable", never adopted by
    // a NEW project (data-model.md §3).
    await db
      .update(schema.stateTemplateTable)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(schema.stateTemplateTable.workspaceId, workspace.id),
          eq(schema.stateTemplateTable.key, "backlog"),
        ),
      );

    const projectResponse = await createProjectNative(app, owner.cookie, {
      workspaceId: workspace.id,
      name: "Support",
      icon: "Folder",
      slug: "support",
    });
    const project = (await projectResponse.json()) as { id: string };

    const activeTemplates = await db.query.stateTemplateTable.findMany({
      where: and(
        eq(schema.stateTemplateTable.workspaceId, workspace.id),
        isNull(schema.stateTemplateTable.archivedAt),
      ),
    });

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(activeTemplates.length);
    expect(states.filter((s) => s.isDefault)).toHaveLength(1);
  });
});
