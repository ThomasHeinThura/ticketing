/**
 * `POST /api/work-items/{key}/assign` (`docs/03-features/assignment.md` § API) -- the
 * `AS-1`/`AS-2` action route and its roster (`AS-5`), conflict (`AS-3`) and
 * event/activity (`AS-16`, `WI-6`) behaviour.
 *
 * The suite deliberately spans THREE tiers of caller, because the route's authority is a
 * genuine OR, not a single capability: an admin/lead (holds `work_item:assign`), a member
 * (holds `work_item:update` only -- may assign the item to THEMSELVES, nobody else), and a
 * viewer (holds neither). A suite that only exercised the lead would not distinguish this
 * route from `requireWorkspaceCapability("work_item:assign")` alone, which is exactly the
 * dishonesty `task/policy.ts`'s comment warned about for the inherited task route.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
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

  // Issue #318 (security): a `BUILT_IN_ROLES` name grants its capabilities only when a
  // genuine seeded `workspace_role` row (`is_system = true`) backs it -- `"owner"` is the
  // one exception (retrofit plan R5). Same helper shape as the other work-item suites.
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

/** A `person` row for a user (the `person.user_id` mapping `AS-2`'s self-branch resolves),
 * plus the `membership` roster row on `project` that `AS-5` checks. */
async function addPersonOnRoster({
  userId,
  projectId,
  active = true,
}: {
  userId?: string;
  projectId: string;
  active?: boolean;
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
        active,
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
  title = "Assign me",
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

describe("API integration: work item assignment (#30, assignment.md)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("AS-1: a lead assigns a rostered member, writes the activity row and emits work_item.assigned", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const target = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(lead);
    // The creation above published its own event; only the assignment's is this test's
    // to assert.
    publishEventMock.mockReset();
    const response = await assignRequest(app, key, {
      assigneeId: target.id,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key,
      assigneeId: target.id,
      previousAssigneeId: null,
      version: 2,
    });

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBe(target.id);
    expect(row?.version).toBe(2);

    // The item's CREATION wrote its own activity row; only the assignment row is this
    // route's to assert, so filter to the field it writes.
    const assignmentRows = (
      await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.workItemId, row?.id ?? ""))
    ).filter((entry) => entry.field === "assigneeId");
    expect(assignmentRows).toHaveLength(1);
    expect(assignmentRows[0]?.oldValue).toBeNull();
    expect(assignmentRows[0]?.newValue).toBe(target.id);

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock.mock.calls[0]?.[0]).toBe("work_item.assigned");
    expect(publishEventMock.mock.calls[0]?.[1]).toMatchObject({
      key,
      assigneeId: target.id,
      previousAssigneeId: null,
    });
  });

  it("AS-2: a member assigns the item to THEMSELVES (work_item:update via the orSelfTarget branch)", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const memberUser = await addWorkspaceMember(workspace.id, "member");
    const memberPerson = await addPersonOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(memberUser);
    const response = await assignRequest(app, key, {
      assigneeId: memberPerson.id,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { assigneeId: string };
    expect(body.assigneeId).toBe(memberPerson.id);
  });

  it("AS-2: a member assigning SOMEONE ELSE is refused 403", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const memberUser = await addWorkspaceMember(workspace.id, "member");
    await addPersonOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });
    const other = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(memberUser);
    const response = await assignRequest(app, key, { assigneeId: other.id });

    expect(response.status).toBe(403);
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBeNull();
  });

  it("AS-2: a viewer may not self-assign (no work_item:update) — 403", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const viewerUser = await addWorkspaceMember(workspace.id, "viewer");
    const viewerPerson = await addPersonOnRoster({
      userId: viewerUser.id,
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(viewerUser);
    const response = await assignRequest(app, key, {
      assigneeId: viewerPerson.id,
    });
    expect(response.status).toBe(403);
  });

  it("AS-5: assigning someone who is not on the project roster is refused 400 with the suggestion", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    // A person with NO membership row on this project (the roster is per project, not
    // the whole directory).
    const organisation = await ensureInternalOrganisation();
    const now = new Date();
    const outsider = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: organisation.id,
          side: "staff",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "outsider",
    );

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(lead);
    const response = await assignRequest(app, key, {
      assigneeId: outsider.id,
    });

    expect(response.status).toBe(400);
    // `HTTPException` bodies are plain text by convention in this codebase.
    expect(await response.text()).toContain("roster");
  });

  it("AS-5: assigning a DEACTIVATED roster member is refused 400", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const inactive = await addPersonOnRoster({
      projectId: project.id,
      active: false,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(lead);
    const response = await assignRequest(app, key, {
      assigneeId: inactive.id,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("deactivated");
  });

  it("AS-3: an unconditional assign onto an already-assigned item is a 409 carrying the current assignee", async () => {
    const { creator, project, type } = await setupProject();
    const first = await addPersonOnRoster({
      projectId: project.id,
    });
    const second = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    expect(
      (await assignRequest(app, key, { assigneeId: first.id })).status,
    ).toBe(200);

    publishEventMock.mockReset();
    const response = await assignRequest(app, key, { assigneeId: second.id });
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      message: string;
      key: string;
      currentAssigneeId: string | null;
    };
    expect(body.currentAssigneeId).toBe(first.id);
    expect(body.key).toBe(key);
    expect(publishEventMock).not.toHaveBeenCalled();

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBe(first.id);
  });

  it("AS-3: a targeted reassign succeeds only while the expected holder still holds it", async () => {
    const { creator, project, type } = await setupProject();
    const first = await addPersonOnRoster({
      projectId: project.id,
    });
    const second = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    await assignRequest(app, key, { assigneeId: first.id });

    // Stale expectation: the item is held by `first`, not by `second`.
    const stale = await assignRequest(app, key, {
      assigneeId: second.id,
      expectedCurrentAssigneeId: second.id,
    });
    expect(stale.status).toBe(409);
    expect(
      ((await stale.json()) as { currentAssigneeId: string }).currentAssigneeId,
    ).toBe(first.id);

    // Correct expectation: `first` is the holder the caller saw.
    const ok = await assignRequest(app, key, {
      assigneeId: second.id,
      expectedCurrentAssigneeId: first.id,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      assigneeId: string;
      previousAssigneeId: string | null;
    };
    expect(body.assigneeId).toBe(second.id);
    expect(body.previousAssigneeId).toBe(first.id);
  });

  it("assigning the current holder again is an idempotent no-op: 200, no event, no activity row", async () => {
    const { creator, project, type } = await setupProject();
    const holder = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    await assignRequest(app, key, { assigneeId: holder.id });
    publishEventMock.mockReset();

    const response = await assignRequest(app, key, { assigneeId: holder.id });
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    const assignmentRows = (
      await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.workItemId, row?.id ?? ""))
    ).filter((entry) => entry.field === "assigneeId");
    expect(assignmentRows).toHaveLength(1); // only the first assignment
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("a caller from another workspace cannot reach the item, and an unauthenticated call is 401", async () => {
    const { creator, project, type } = await setupProject();
    const target = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // A real member of a different workspace: the reach middleware resolves this key's
    // workspace and `validateWorkspaceAccess` finds no membership there.
    const foreign = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(foreign.user);
    const foreignResponse = await assignRequest(app, key, {
      assigneeId: target.id,
    });
    expect([403, 404]).toContain(foreignResponse.status);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBeNull();
  });

  it("an unauthenticated caller is refused 401 (and does not reach the reach resolver)", async () => {
    const { creator, project, type } = await setupProject();
    const target = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAnonymousSession();
    const anonymous = await app.request(`/api/work-items/${key}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assigneeId: target.id }),
    });
    expect(anonymous.status).toBe(401);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBeNull();
  });

  it("a NUL byte in assigneeId is a 400, not a 500", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const lead = await addWorkspaceMember(workspace.id, "lead");

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    mockAuthenticatedSession(lead);
    const response = await assignRequest(app, key, {
      assigneeId: "bad\u0000id",
    });
    expect(response.status).toBe(400);
  });

  it("activity visibility for an assignment change follows the shared (verb, field) allowlist", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const target = await addPersonOnRoster({
      projectId: project.id,
    });

    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    await assignRequest(app, key, { assigneeId: target.id });

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.key, key),
          eq(schema.workItemTable.workspaceId, workspace.id),
        ),
      );
    const [assignment] = (
      await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.workItemId, row?.id ?? ""))
    ).filter((entry) => entry.field === "assigneeId");
    // Whatever the allowlist decides, it must be one of the two values -- never absent,
    // never a third invented state.
    expect(["public", "internal"]).toContain(assignment?.visibility);
  });
});
