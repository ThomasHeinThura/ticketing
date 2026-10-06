import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const priorEnforcementSetting = vi.hoisted(() => {
  return process.env.TASKDESK_POLICY_ENFORCE;
});

import db, { schema } from "../../apps/api/src/database";
import { policyRegistry } from "../../apps/api/src/policy-registry";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

function hashApiKey(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createWorkItemType(workspaceId: string) {
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
    "strict runtime work item type",
  );
}

async function createDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const template = requireRow(
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
    "strict runtime state template",
  );
  await db.insert(schema.stateTable).values({
    projectId,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function createCustomerIdentity(organisationId: string) {
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `customer-${randomUUID()}`,
        email: `customer-${randomUUID()}@example.com`,
        emailVerified: true,
        name: "Customer test identity",
      })
      .returning(),
    "strict runtime customer user",
  );
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: user.id,
        organisationId,
        side: "customer",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(),
    "strict runtime customer person",
  );
  return { user, person };
}

async function grantProjectReach(
  userId: string,
  workspaceId: string,
  projectId: string,
  capabilities = ["work_item:create", "work_item:read", "work_item:assign"],
) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!person) throw new Error("expected seeded staff identity");
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        workspaceId,
        key: `read-${randomUUID()}`,
        name: "Project reader",
        rank: 1,
        capabilities,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(),
    "strict runtime project role",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId: role.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("strict policy runtime enforcement against the production API graph", () => {
  beforeAll(async () => {
    const registeredSources = [
      ...new Set(policyRegistry.entries.map(({ source }) => source)),
    ];
    const taskPolicySource = registeredSources.find((source) =>
      source.endsWith("/task/policy.ts"),
    );
    if (!taskPolicySource)
      throw new Error(
        "The production policy registry has no task policy source.",
      );
    process.env.TASKDESK_POLICY_ENFORCE = [
      ...registeredSources.filter((source) => source !== taskPolicySource),
      taskPolicySource,
    ].join(",");
    await import("../../apps/api/src/index");
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function createStrictApp() {
    const { createApp } = await import("../../apps/api/src/index");
    return createApp();
  }

  afterAll(() => {
    if (priorEnforcementSetting === undefined) {
      delete process.env.TASKDESK_POLICY_ENFORCE;
    } else {
      process.env.TASKDESK_POLICY_ENFORCE = priorEnforcementSetting;
    }
  });

  it("denies an API-key assignment at the terminal route boundary before any row or activity mutation", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectReach(member.user.id, member.workspace.id, project.id);
    const type = await createWorkItemType(member.workspace.id);
    await createDefaultState(member.workspace.id, project.id);

    mockAuthenticatedSession(member.user);
    const { app } = await createStrictApp();
    const createResponse = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: type.id, title: "Policy gate target" }),
      },
    );
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const { key } = (await createResponse.json()) as { key: string };
    const [requester] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    expect(requester).toBeDefined();
    await db
      .update(schema.workItemTable)
      .set({ requesterId: requester?.id })
      .where(eq(schema.workItemTable.key, key));

    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashApiKey(rawKey),
      name: "strict enforcement test key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [before] = await db
      .select({
        id: schema.workItemTable.id,
        assigneeId: schema.workItemTable.assigneeId,
        version: schema.workItemTable.version,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(before).toBeDefined();
    const beforeActivities = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, before?.id ?? ""));
    const [assignee] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    expect(assignee).toBeDefined();
    const denied = await app.request(`/api/work-items/${key}/assign`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ assigneeId: assignee?.id }),
    });
    expect(denied.status).toBe(403);

    const [after] = await db
      .select({
        id: schema.workItemTable.id,
        assigneeId: schema.workItemTable.assigneeId,
        version: schema.workItemTable.version,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    const afterActivities = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, before?.id ?? ""));
    expect(after).toEqual(before);
    expect(afterActivities.map((row) => row.id)).toEqual(
      beforeActivities.map((row) => row.id),
    );

    mockAuthenticatedSession(member.user);
    const allowed = await app.request(`/api/work-items/${key}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assigneeId: assignee?.id }),
    });
    expect(allowed.status).toBe(200);
    const [afterAllowed] = await db
      .select({ assigneeId: schema.workItemTable.assigneeId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(afterAllowed?.assigneeId).toBe(assignee?.id);
  });

  it("uses the addressed row's workspace and refuses a caller query hint for another workspace", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const foreign = await createWorkspaceMember({ role: "admin" });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await grantProjectReach(
      foreign.user.id,
      foreign.workspace.id,
      foreignProject.id,
    );
    const foreignType = await createWorkItemType(foreign.workspace.id);
    await createDefaultState(foreign.workspace.id, foreignProject.id);

    mockAuthenticatedSession(foreign.user);
    const { app } = await createStrictApp();
    const createResponse = await app.request(
      `/api/projects/${foreignProject.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: foreignType.id,
          title: "Foreign target",
        }),
      },
    );
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const { key } = (await createResponse.json()) as { key: string };

    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: owner.user.id,
      userId: owner.user.id,
      key: hashApiKey(rawKey),
      name: "strict scope test key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request(
      `/api/work-items/${key}/assign?workspaceId=${encodeURIComponent(owner.workspace.id)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${rawKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ assigneeId: "some-other-person" }),
      },
    );
    expect(response.status).toBe(404);
    const [item] = await db
      .select({ assigneeId: schema.workItemTable.assigneeId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(item?.assigneeId).toBeNull();
  });

  it("evaluates the legacy task table row on the final task-source cutover path", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectReach(member.user.id, member.workspace.id, project.id);
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    expect(person).toBeDefined();
    const legacyTask = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Legacy task source target",
          description: "Owned by the persisted assignee row",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
          userId: member.user.id,
        })
        .returning(),
      "strict runtime legacy task",
    );

    mockAuthenticatedSession(member.user);
    const { app } = await createStrictApp();
    const response = await app.request(`/api/task/${legacyTask.id}`);

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: legacyTask.id,
      userId: member.user.id,
    });
  });

  it("uses the persisted assignee for the self-unassign owner branch", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectReach(member.user.id, member.workspace.id, project.id, [
      "work_item:create",
      "work_item:read",
      "work_item:update",
    ]);
    const type = await createWorkItemType(member.workspace.id);
    await createDefaultState(member.workspace.id, project.id);

    mockAuthenticatedSession(member.user);
    const { app } = await createStrictApp();
    const createResponse = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Self unassign target",
        }),
      },
    );
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const { key } = (await createResponse.json()) as { key: string };
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    expect(person).toBeDefined();
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: person?.id, requesterId: person?.id })
      .where(eq(schema.workItemTable.key, key));

    const response = await app.request(`/api/work-items/${key}/assign`, {
      method: "DELETE",
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const [after] = await db
      .select({ assigneeId: schema.workItemTable.assigneeId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(after?.assigneeId).toBeNull();
  });

  it("limits private work-item participant visibility to customers, not staff", async () => {
    const staff = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: staff.workspace.id,
    });
    await grantProjectReach(staff.user.id, staff.workspace.id, project.id);
    const type = await createWorkItemType(staff.workspace.id);
    await createDefaultState(staff.workspace.id, project.id);

    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `customer-org-${randomUUID()}`,
          name: "Private visibility customer organisation",
          isInternal: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "strict runtime customer organisation",
    );
    await db
      .update(schema.workspaceTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.workspaceTable.id, staff.workspace.id));
    const participant = await createCustomerIdentity(organisation.id);
    mockAuthenticatedSession(staff.user);
    const { app } = await createStrictApp();
    const createResponse = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Private customer item",
        }),
      },
    );
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const { key } = (await createResponse.json()) as { key: string };
    await db
      .update(schema.workItemTable)
      .set({
        requesterId: participant.person.id,
        customerVisibility: "private",
      })
      .where(eq(schema.workItemTable.key, key));

    // Staff has persisted project membership but is neither requester nor watcher.
    mockAuthenticatedSession(staff.user);
    const staffResponse = await app.request(`/api/work-items/${key}`);
    expect(staffResponse.status, await staffResponse.clone().text()).toBe(200);

    // CP-19 keeps the customer portal origin disabled, so this route does not emulate a
    // customer portal journey. Participant/nonparticipant reach is tested in the shared
    // evaluator against the documented customer identity contract.
    expect(participant.person.organisationId).toBe(organisation.id);
  });
});
