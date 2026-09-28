/**
 * `POST /api/work-items/{key}/transition` and `GET /api/work-items/{key}/transitions`
 * (issue #442, `docs/03-features/workflows.md`) -- the state-transition EXECUTION route
 * the persistence PR (#31/#443) deliberately left unbuilt.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
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

/** A standalone `person` row for use as a pure assignee target -- no login, no `user_id`.
 * `onRoster` inserts a `membership` row scoped to `projectId` (any role -- eligibility
 * only checks presence, per `assignee-eligibility.ts`). */
async function makeAssigneePerson(options: {
  projectId?: string;
  active?: boolean;
}) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "staff",
        active: options.active ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeAssigneePerson",
  );
  if (options.projectId) {
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "project",
          key: `role-${randomUUID()}`,
          name: "Project Member",
          rank: 1,
        })
        .returning(),
      "makeAssigneePerson: role",
    );
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "project",
      scopeId: options.projectId,
      roleId: role.id,
    });
  }
  return person;
}

/** A second, independent raw connection for a genuinely concurrent, uncommitted
 * transaction -- same pattern as `work-item-parent-cycle-guard.test.ts`. */
async function openRawClient(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  return client;
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

  it("B1 (Opus security review of PR #457): a concurrent write clearing the assignee cannot slip past an assignee_present guard", async () => {
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
        guards: [{ type: "assignee_present" }],
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const assignee = await makeAssigneePerson({ projectId: project.id });
    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    const workItemId = requireRow([workItemRow], "workItemRow").id;
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: assignee.id })
      .where(eq(schema.workItemTable.id, workItemId));

    const raw = await openRawClient();
    try {
      await raw.query("BEGIN");
      // Uncommitted: clears the assignee this guard needs, and holds the row lock.
      await raw.query("UPDATE work_item SET assignee_id = NULL WHERE id = $1", [
        workItemId,
      ]);

      const responsePromise = transitionRequest(app, key, {
        toStateTemplateId: done.stateTemplate.id,
      });
      responsePromise.catch(() => {});

      // Give the app's own `SELECT ... FOR UPDATE` time to reach Postgres and start
      // blocking on the still-open transaction above before it is released.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await raw.query("COMMIT");

      const response = await responsePromise;
      // Pre-fix (B1): this returned 200, having evaluated the guard against the STALE,
      // pre-transaction read that still saw an assignee. Post-fix: the locked read sees
      // the now-committed `assignee_id = NULL`, so the guard blocks.
      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        blockedBy: { kind: string; reasonCode: string }[];
      };
      expect(body.blockedBy).toEqual([
        { kind: "guard", reasonCode: "guard.assignee_present" },
      ]);
    } finally {
      await raw.end();
    }

    const [finalRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemId));
    // Blocked -- the state never moved.
    expect(finalRow?.stateId).toBe(backlog.state.id);
  });

  it("B2 (Opus security review of PR #457): set_assignee refuses an off-roster/inactive target and leaves the whole transition unapplied", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const ineligible = await makeAssigneePerson({ active: true }); // no roster row at all
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
        effects: [{ kind: "set_assignee", personId: ineligible.id }],
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const response = await transitionRequest(app, key, {
      toStateTemplateId: inProgress.stateTemplate.id,
    });
    // Pre-fix (B2): this returned 200 and wrote `ineligible.id` straight into
    // `assignee_id`, with no roster/active/tenant check at all.
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      blockedBy: { kind: string; reasonCode: string }[];
    };
    expect(body.blockedBy).toEqual([
      { kind: "assignee", reasonCode: "assignee.not_on_roster" },
    ]);

    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    // The WHOLE transition is refused -- state doesn't move either, matching the
    // review's own instruction ("fail the whole transition closed").
    expect(workItemRow?.assigneeId).toBeNull();
    expect(workItemRow?.stateId).toBe(backlog.state.id);
  });

  it("set_assignee applies for an eligible target and publishes work_item.assigned", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const eligible = await makeAssigneePerson({ projectId: project.id });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
        effects: [{ kind: "set_assignee", personId: eligible.id }],
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
    const body = (await response.json()) as { assigneeId: string | null };
    expect(body.assigneeId).toBe(eligible.id);

    expect(publishEventMock).toHaveBeenCalledWith(
      "work_item.assigned",
      expect.objectContaining({
        key,
        assigneeId: eligible.id,
        previousAssigneeId: null,
      }),
    );

    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, workItemRow?.id ?? ""),
          eq(schema.activityTable.field, "assigneeId"),
        ),
      );
    expect(activityRows).toHaveLength(1);
  });

  it("schedule_transition inserts a pending scheduled_transition row", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const inProgress = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const later = await makeState(workspace.id, project.id, {
      group: "completed",
    });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: inProgress.stateTemplate.id,
        roleId: null,
        effects: [
          {
            kind: "schedule_transition",
            afterMinutes: 60,
            toStateTemplateId: later.stateTemplate.id,
          },
        ],
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const response = await transitionRequest(app, key, {
      toStateTemplateId: inProgress.stateTemplate.id,
    });
    expect(response.status).toBe(200);

    const [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    const scheduled = await db
      .select()
      .from(schema.scheduledTransitionTable)
      .where(
        eq(schema.scheduledTransitionTable.workItemId, workItemRow?.id ?? ""),
      );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.toStateId).toBe(later.state.id);
    expect(scheduled[0]?.state).toBe("pending");
  });

  it("WF-18: leaving the completed group clears resolved_at", async () => {
    const { creator, workspace, project } = await setupProject();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const done = await makeState(workspace.id, project.id, {
      group: "completed",
    });
    const reopened = await makeState(workspace.id, project.id, {
      group: "started",
    });
    const { workflow } = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: done.stateTemplate.id,
        roleId: null,
      },
      {
        fromStateTemplateId: done.stateTemplate.id,
        toStateTemplateId: reopened.stateTemplate.id,
        roleId: null,
        isReopen: true,
      },
    ]);
    const type = await makeWorkItemType(workspace.id, workflow.id);

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const toDone = await transitionRequest(app, key, {
      toStateTemplateId: done.stateTemplate.id,
    });
    expect(toDone.status).toBe(200);
    let [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(workItemRow?.resolvedAt).not.toBeNull();

    const toReopened = await transitionRequest(app, key, {
      toStateTemplateId: reopened.stateTemplate.id,
    });
    expect(toReopened.status).toBe(200);
    [workItemRow] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(workItemRow?.resolvedAt).toBeNull();
  });
});
