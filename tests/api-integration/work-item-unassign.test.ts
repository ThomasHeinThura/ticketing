/**
 * `DELETE /api/work-items/{key}/assign` (`docs/03-features/assignment.md` § API) -- the
 * `AS-2` self-unassign branch, `AS-9`'s "never silently unassigned" guard, and `AS-17`'s
 * `work_item.unassigned` event.
 *
 * Three tiers of caller, mirroring the assign suite: a lead (holds `work_item:assign`),
 * a member (holds `work_item:update` only -- may clear THEIR OWN item, nobody else's),
 * and a viewer (holds neither, and is refused even when the row names them -- the
 * conjunction, not the capability alone, is the branch).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { WorkItemAssigneeConflictError } from "../../apps/api/src/work-item/controllers/assign-work-item";
import { unassignWorkItem } from "../../apps/api/src/work-item/controllers/unassign-work-item";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
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

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state_template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state",
  );
  return state;
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

  // Issue #318: the built-in name grants capabilities only when a genuine seeded
  // `workspace_role` row (`is_system = true`) backs it; `"owner"` is the exception.
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

/** A `person` row (the `person.user_id` mapping both assignment branches resolve), plus
 * the `membership` roster row on `project` that the roster rules check. */
async function addPersonOnRoster({
  userId,
  projectId,
}: {
  userId?: string;
  projectId: string;
}) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: userId ?? null,
        organisationId: organisation.id,
        side: "staff",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "addPersonOnRoster: person",
  );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        key: `role-${randomUUID()}`,
        name: "Project Member",
        rank: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "addPersonOnRoster: role",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId: role.id,
    createdAt: now,
    updatedAt: now,
  });
  return person;
}

async function setupProject() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const type = await makeWorkItemType(workspace.id);
  await makeDefaultState(workspace.id, project.id);
  return { creator, workspace, project, type };
}

async function createWorkItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
  title = "Unassign me",
) {
  const created = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title }),
  });
  const body = (await created.json()) as { key: string; version: number };
  return body;
}

function assignRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unassignRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
) {
  return app.request(`/api/work-items/${key}/assign`, { method: "DELETE" });
}

async function assigneeActivityRows(workItemId: string) {
  return (
    await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, workItemId))
  ).filter((entry) => entry.field === "assigneeId");
}

describe("API integration: work item unassignment (#30, assignment.md)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("AS-2: the member who HOLDS the item clears it with work_item:update, writing the activity row and emitting work_item.unassigned", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const memberUser = await addWorkspaceMember(workspace.id, "member");
    const memberPerson = await addPersonOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    expect(
      await assignRequest(app, key, { assigneeId: memberPerson.id }),
    ).toHaveProperty("status", 200);
    publishEventMock.mockReset();

    mockAuthenticatedSession(memberUser);
    const response = await unassignRequest(app, key);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key,
      assigneeId: null,
      previousAssigneeId: memberPerson.id,
      version: 3,
    });

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBeNull();
    expect(row?.version).toBe(3);

    const clears = (await assigneeActivityRows(row?.id ?? "")).filter(
      (entry) => entry.newValue === null,
    );
    expect(clears).toHaveLength(1);
    expect(clears[0]?.oldValue).toBe(memberPerson.id);

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock.mock.calls[0]?.[0]).toBe("work_item.unassigned");
    expect(publishEventMock.mock.calls[0]?.[1]).toMatchObject({
      key,
      previousAssigneeId: memberPerson.id,
    });
  });

  it("AS-2/AS-9: a member with work_item:update clearing a COLLEAGUE's item is refused 403, and nothing changes", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const memberUser = await addWorkspaceMember(workspace.id, "member");
    await addPersonOnRoster({ userId: memberUser.id, projectId: project.id });
    const holder = await addPersonOnRoster({ projectId: project.id });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    await assignRequest(app, key, { assigneeId: holder.id });
    publishEventMock.mockReset();

    mockAuthenticatedSession(memberUser);
    expect((await unassignRequest(app, key)).status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBe(holder.id);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("a holder WITHOUT the branch capability is still refused (the branch is a conjunction, not a bypass)", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const viewerUser = await addWorkspaceMember(workspace.id, "viewer");
    const viewerPerson = await addPersonOnRoster({
      userId: viewerUser.id,
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    await assignRequest(app, key, { assigneeId: viewerPerson.id });
    publishEventMock.mockReset();

    // The row NAMES the viewer, but a viewer holds neither work_item:assign nor
    // work_item:update -- so neither branch passes.
    mockAuthenticatedSession(viewerUser);
    expect((await unassignRequest(app, key)).status).toBe(403);
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBe(viewerPerson.id);
  });

  it("a lead clears someone else's item (work_item:assign)", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const holder = await addPersonOnRoster({ projectId: project.id });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    await assignRequest(app, key, { assigneeId: holder.id });
    publishEventMock.mockReset();

    mockAuthenticatedSession(lead);
    const response = await unassignRequest(app, key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      assigneeId: null;
      previousAssigneeId: string | null;
    };
    expect(body.assigneeId).toBeNull();
    expect(body.previousAssigneeId).toBe(holder.id);

    expect(publishEventMock.mock.calls[0]?.[0]).toBe("work_item.unassigned");
  });

  it("clearing an already-unassigned item is an idempotent 200 no-op: no version bump, no activity row, no event", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, version } = await createWorkItem(app, project.id, type.id);
    publishEventMock.mockReset();

    mockAuthenticatedSession(lead);
    const response = await unassignRequest(app, key);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key,
      assigneeId: null,
      previousAssigneeId: null,
      version,
    });

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.version).toBe(version);
    expect(await assigneeActivityRows(row?.id ?? "")).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("two concurrent clears produce exactly one write: one response allowed, the other a no-op 200 or a 409 -- never a second activity row", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const holder = await addPersonOnRoster({ projectId: project.id });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    await assignRequest(app, key, { assigneeId: holder.id });
    publishEventMock.mockReset();

    mockAuthenticatedSession(lead);
    // Both requests read the same holder before either write commits. Which of the two
    // interleavings happens is genuinely up to Postgres: the loser either finds the row
    // already clear (idempotent no-op, 200) or its conditional write matches zero rows
    // first (409). Both are correct `AS-9` answers -- what must NOT happen is two
    // clears, so that is what this asserts.
    const [a, b] = await Promise.all([
      unassignRequest(app, key),
      unassignRequest(app, key),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toContain(200);
    for (const status of statuses) {
      expect([200, 409]).toContain(status);
    }

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBeNull();
    const clears = (await assigneeActivityRows(row?.id ?? "")).filter(
      (entry) => entry.newValue === null,
    );
    expect(clears).toHaveLength(1);

    const conflict = [a, b].find((response) => response.status === 409);
    if (conflict !== undefined) {
      const body = (await conflict.json()) as { currentAssigneeId: null };
      expect(body.currentAssigneeId).toBeNull();
    }
  });

  it("F1: a holder change between the authority decision and the write is refused 409, never cleared (the observed-value pin)", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const first = await addPersonOnRoster({ projectId: project.id });
    const second = await addPersonOnRoster({ projectId: project.id });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    await assignRequest(app, key, { assigneeId: second.id });
    publishEventMock.mockReset();

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));

    // The handler's authority decision was made against `first`; the row now holds
    // `second` (as if a reassignment landed after the check). The controller must
    // refuse on the mismatch -- clearing here would clear the NEW holder's assignment,
    // which is the exact authority hole the ordinary review of PR #365 demonstrated
    // with a probe. Called at the controller layer because that is where the pin
    // lives; the route-level path to the same window is timing-dependent.
    await expect(
      unassignWorkItem(key, workspace.id, "user-probe", "person", first.id),
    ).rejects.toThrow(WorkItemAssigneeConflictError);

    const [after] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(after?.assigneeId).toBe(second.id);
    expect(
      (await assigneeActivityRows(row?.id ?? "")).filter(
        (entry) => entry.newValue === null,
      ),
    ).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();

    // The observed value that MATCHES still clears (the pin is not a blanket refusal).
    const cleared = await unassignWorkItem(
      key,
      workspace.id,
      "user-probe",
      "person",
      second.id,
    );
    expect(cleared.previousAssigneeId).toBe(second.id);
    const [final] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(final?.assigneeId).toBeNull();
  });

  it("a caller from another workspace cannot reach the item, and an unauthenticated call is 401", async () => {
    const { creator, project, type } = await setupProject();

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const foreign = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(foreign.user);
    const foreignResponse = await unassignRequest(app, key);
    expect([403, 404]).toContain(foreignResponse.status);

    mockAnonymousSession();
    const anonymous = await app.request(`/api/work-items/${key}/assign`, {
      method: "DELETE",
    });
    expect(anonymous.status).toBe(401);
  });
});
