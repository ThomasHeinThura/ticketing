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
import {
  APPROVED_TEMPLATE_KEY,
  CAB_WORKFLOW_KEY,
} from "../../apps/api/src/service-management/cab-template";
import { DEFAULT_STATE_TEMPLATES } from "../../apps/api/src/utils/default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "../../apps/api/src/utils/default-work-item-types";
import { defaultWorkflowId } from "../../apps/api/src/utils/seed-default-workflow";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { grantWorkItemProjectAccess } from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

async function createProjectNative(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  body: { workspaceId: string; name: string; icon: string; slug: string },
): Promise<Response> {
  return csrfRequest(
    app,
    "/api/project",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

describe("API integration: workspace/project default seeding (#309)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("seeds default types, CAB-required change workflow and states for a fresh workspace", async () => {
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
      if (expected.isChange) {
        const workflow = await db.query.workflowTable.findFirst({
          where: eq(schema.workflowTable.id, row?.workflowId ?? ""),
        });
        expect(workflow?.key).toBe(CAB_WORKFLOW_KEY);
      } else {
        expect(row?.workflowId).toBe(defaultWorkflowId(workspace.id));
      }
    }

    const change = types.find((t) => t.key === "change");
    const changeWorkflow = await db.query.workflowTable.findFirst({
      where: eq(schema.workflowTable.id, change?.workflowId ?? ""),
    });
    const changeEdges = await db.query.workflowTransitionTable.findMany({
      where: eq(
        schema.workflowTransitionTable.versionId,
        changeWorkflow?.activeVersionId ?? "",
      ),
    });
    expect(changeWorkflow?.key).toBe(CAB_WORKFLOW_KEY);
    expect(changeEdges.some((edge) => edge.requiresCab)).toBe(true);
    expect(
      changeEdges.filter((edge) => edge.requiresCab).length,
    ).toBeGreaterThan(0);

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, workspace.id),
    });
    expect(templates).toHaveLength(DEFAULT_STATE_TEMPLATES.length + 1);
    expect(new Set(templates.map((t) => t.key))).toEqual(
      new Set([
        ...DEFAULT_STATE_TEMPLATES.map((t) => t.key),
        APPROVED_TEMPLATE_KEY,
      ]),
    );
    for (const expected of DEFAULT_STATE_TEMPLATES) {
      const row = templates.find((t) => t.key === expected.key);
      expect(row).toMatchObject({ name: expected.name, group: expected.group });
    }
    expect(
      templates.find((t) => t.key === APPROVED_TEMPLATE_KEY),
    ).toMatchObject({
      name: "Approved",
      group: "unstarted",
    });
    const toDo = templates.find((t) => t.key === "to-do");
    const inProgress = templates.find((t) => t.key === "in-progress");
    const approved = templates.find((t) => t.key === APPROVED_TEMPLATE_KEY);
    expect(
      changeEdges.some(
        (edge) =>
          edge.fromStateTemplateId === toDo?.id &&
          edge.toStateTemplateId === inProgress?.id,
      ),
    ).toBe(false);
    expect(
      changeEdges.some(
        (edge) =>
          edge.fromStateTemplateId === toDo?.id &&
          edge.toStateTemplateId === approved?.id &&
          edge.requiresCab,
      ),
    ).toBe(true);

    const templateStatus = await app.request(
      `/api/change-cab-template?workspaceId=${workspace.id}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(templateStatus.status).toBe(200);
    expect(await templateStatus.json()).toMatchObject({
      applied: true,
      changeTypeCount: 1,
      adoptedProjectIds: [],
    });
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
      slug: "SUPPORT",
    });
    expect(projectResponse.status).toBe(200);
    const project = (await projectResponse.json()) as {
      id: string;
      slug: string;
    };
    // Creating a project grants the creator no project membership, and the work-item create
    // route requires project reach (#720): give the owner the item authority explicitly.
    await grantWorkItemProjectAccess(owner.user.id, project.id);

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(DEFAULT_STATE_TEMPLATES.length + 1);
    const approvedTemplate = await db.query.stateTemplateTable.findFirst({
      where: and(
        eq(schema.stateTemplateTable.workspaceId, workspace.id),
        eq(schema.stateTemplateTable.key, APPROVED_TEMPLATE_KEY),
      ),
    });
    expect(
      states.some((state) => state.stateTemplateId === approvedTemplate?.id),
    ).toBe(true);

    const defaults = states.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);

    const defaultTemplate = await db.query.stateTemplateTable.findFirst({
      where: eq(
        schema.stateTemplateTable.id,
        defaults[0]?.stateTemplateId ?? "",
      ),
    });
    expect(defaultTemplate?.key).toBe("to-do");
    expect(defaultTemplate?.group).toBe("unstarted");

    // No fixture SQL from here: the type comes from the workspace's own seeded rows.
    const type = await db.query.workItemTypeTable.findFirst({
      where: and(
        eq(schema.workItemTypeTable.workspaceId, workspace.id),
        eq(schema.workItemTypeTable.key, "task"),
      ),
    });
    expect(type).toBeTruthy();

    const workItemResponse = await csrfRequest(
      app,
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          typeId: type?.id,
          title: "Printer is on fire",
        }),
      },
      owner.cookie,
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

    const changeType = await db.query.workItemTypeTable.findFirst({
      where: and(
        eq(schema.workItemTypeTable.workspaceId, workspace.id),
        eq(schema.workItemTypeTable.key, "change"),
      ),
    });
    const changeResponse = await csrfRequest(
      app,
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          typeId: changeType?.id,
          title: "Planned change",
        }),
      },
      owner.cookie,
    );
    expect(changeResponse.status).toBe(200);
    const changeItem = (await changeResponse.json()) as { key: string };
    const transitionsResponse = await app.request(
      `/api/work-items/${changeItem.key}/transitions`,
      { headers: { cookie: owner.cookie } },
    );
    expect(transitionsResponse.status).toBe(200);
    const transitions = (await transitionsResponse.json()) as Array<{
      toStateName: string;
      requiresCab: boolean;
    }>;
    expect(
      transitions.some(
        (transition) =>
          transition.toStateName === "Approved" && transition.requiresCab,
      ),
    ).toBe(true);
    expect(
      transitions.map((transition) => transition.toStateName),
    ).not.toContain("In Progress");
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
      slug: "SUPPORT",
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
      slug: "SUPPORT",
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
