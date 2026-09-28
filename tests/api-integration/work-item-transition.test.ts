/**
 * `POST /api/work-items/{key}/transition` and `GET /api/work-items/{key}/transitions`
 * (issue #442, `docs/03-features/workflows.md`) -- the state-transition EXECUTION route
 * the persistence PR (#31/#443) deliberately left unbuilt.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const publishEventMock = vi.hoisted(() => vi.fn());

vi.mock("../../apps/api/src/events", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/events")>();
  return { ...actual, publishEvent: publishEventMock };
});

beforeEach(() => {
  publishEventMock.mockReset();
});

async function makeWorkItemType(
  workspaceId: string,
  workflowId: string | null,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Ticket",
        category: "service",
        workflowId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeState(
  workspaceId: string,
  projectId: string,
  options: { group: string; isDefault?: boolean },
) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: options.group,
        group: options.group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState: state_template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: options.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState: state",
  );
  return { stateTemplate, state };
}

async function makeWorkflow(
  workspaceId: string,
  transitions: (Partial<typeof schema.workflowTransitionTable.$inferInsert> & {
    fromStateTemplateId: string | null;
    toStateTemplateId: string;
  })[],
) {
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId,
        key: `wf-${randomUUID()}`,
        name: "Ticket workflow",
      })
      .returning(),
    "makeWorkflow: workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "makeWorkflow: version",
  );
  const insertedTransitions =
    transitions.length === 0
      ? []
      : await db
          .insert(schema.workflowTransitionTable)
          .values(
            transitions.map((t) => ({
              versionId: version.id,
              guards: [],
              effects: [],
              ...t,
            })),
          )
          .returning();
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  return { workflow, version, transitions: insertedTransitions };
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: "Integration Test User",
      })
      .returning(),
    "addWorkspaceMember: user",
  );

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if (role !== "owner") {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return user;
}

/** A `person` row for a user, mapping `person.user_id` for actor-role resolution. */
async function makePerson(userId: string) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId,
        organisationId: organisation.id,
        side: "staff",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makePerson",
  );
}

async function setupProject() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  return { creator, workspace, project };
}

async function createWorkItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
) {
  const created = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title: "Transition me" }),
  });
  return (await created.json()) as { key: string; stateId: string };
}

function transitionRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listTransitions(
  app: ReturnType<typeof createApp>["app"],
  key: string,
) {
  return app.request(`/api/work-items/${key}/transitions`);
}

describe("API integration: work item transition (#442, workflows.md)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects a caller without work_item:transition with 403", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const viewer = await addWorkspaceMember(workspace.id, "viewer");
    mockAuthenticatedSession(viewer);
    const response = await transitionRequest(app, key, {
      toStateTemplateId: inProgress.stateTemplate.id,
    });
    expect(response.status).toBe(403);
  });

  it("409s when no transition matches the requested target from the current state", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const done = await makeState(workspace.id, project.id, {
      group: "completed",
    });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // There is no backlog -> done edge at all.
    const response = await transitionRequest(app, key, {
      toStateTemplateId: done.stateTemplate.id,
    });
    expect(response.status).toBe(409);
  });

  it("succeeds: writes the state, an activity row, and publishes work_item.transitioned", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const { workflow, version } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    publishEventMock.mockReset();

    const response = await transitionRequest(app, key, {
      toStateTemplateId: inProgress.stateTemplate.id,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stateId: string;
      version: number;
    };
    expect(body.stateId).toBe(inProgress.state.id);
    expect(body.version).toBe(2);

    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(workItemRow?.stateId).toBe(inProgress.state.id);

    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, workItemRow?.id ?? ""),
          eq(schema.activityTable.verb, "transitioned"),
        ),
      );
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]?.workflowVersionId).toBe(version.id);

    expect(publishEventMock).toHaveBeenCalledWith(
      "work_item.transitioned",
      expect.objectContaining({
        key,
        fromStateId: backlog.state.id,
        toStateId: inProgress.state.id,
        workflowVersion: version.number,
      }),
    );
  });

  it("WF-10: blocks with 422 when a required note is missing, then succeeds with one", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const done = await makeState(workspace.id, project.id, {
      group: "completed",
    });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: done.stateTemplate.id,
        roleId: null,
        notePolicy: "required",
        noteVisibility: "public",
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const blocked = await transitionRequest(app, key, {
      toStateTemplateId: done.stateTemplate.id,
    });
    expect(blocked.status).toBe(422);
    const blockedBody = (await blocked.json()) as {
      blockedBy: { kind: string; reasonCode: string }[];
    };
    expect(blockedBody.blockedBy).toEqual([
      { kind: "note", reasonCode: "note.required" },
    ]);

    const withNote = await transitionRequest(app, key, {
      toStateTemplateId: done.stateTemplate.id,
      note: "Fixed the underlying cause.",
    });
    expect(withNote.status).toBe(200);

    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    // WF-17: entering the `completed` group sets `resolved_at`.
    expect(workItemRow?.resolvedAt).not.toBeNull();

    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, workItemRow?.id ?? ""));
    expect(comments).toHaveLength(1);
    expect(comments[0]?.visibility).toBe("public");
  });

  it("GET /transitions returns only the legal edge, disabled with a reason when blocked", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const done = await makeState(workspace.id, project.id, {
      group: "completed",
    });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
      },
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: done.stateTemplate.id,
        roleId: null,
        notePolicy: "required",
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const response = await listTransitions(app, key);
    expect(response.status).toBe(200);
    const offers = (await response.json()) as {
      toStateTemplateId: string;
      available: boolean;
      blockedBy: { kind: string; reasonCode: string }[];
    }[];
    expect(offers).toHaveLength(2);
    const toInProgress = offers.find(
      (o) => o.toStateTemplateId === inProgress.stateTemplate.id,
    );
    const toDone = offers.find(
      (o) => o.toStateTemplateId === done.stateTemplate.id,
    );
    expect(toInProgress?.available).toBe(true);
    expect(toDone?.available).toBe(false);
    expect(toDone?.blockedBy).toEqual([
      { kind: "note", reasonCode: "note.required" },
    ]);
  });

  it("role-gated transition: only an actor holding the transition's role may take it", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "project",
          key: `role-${randomUUID()}`,
          name: "Reviewer",
          rank: 1,
        })
        .returning(),
      "role",
    );
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: role.id,
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    const member = await addWorkspaceMember(workspace.id, "member");
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // The member holds work_item:transition (route capability) but no membership
    // row carrying THIS transition's own role -- the domain engine's own legality
    // check, distinct from the route's capability gate.
    mockAuthenticatedSession(member);
    const withoutRole = await transitionRequest(app, key, {
      toStateTemplateId: inProgress.stateTemplate.id,
    });
    expect(withoutRole.status).toBe(409);

    const memberPerson = await makePerson(member.id);
    await db.insert(schema.membershipTable).values({
      personId: memberPerson.id,
      scope: "project",
      scopeId: project.id,
      roleId: role.id,
    });

    const withRole = await transitionRequest(app, key, {
      toStateTemplateId: inProgress.stateTemplate.id,
    });
    expect(withRole.status).toBe(200);
  });
});
