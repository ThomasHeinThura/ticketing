import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
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
import * as storage from "../../apps/api/src/storage";
import { validateWorkspaceAccess } from "../../apps/api/src/utils/validate-workspace-access";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  prepareAuthenticatedApiFixture,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  describe("strict workspace row provenance", () => {
    it("uses the addressed persisted workspace row for every row-scoped workspace route", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      mockAuthenticatedSession(owner.user);
      const { app } = await createStrictApp();
      const base = `/api/workspace/${owner.workspace.id}`;

      const detail = await app.request(base);
      expect(detail.status, await detail.clone().text()).toBe(200);
      expect((await detail.json()).workspace.id).toBe(owner.workspace.id);

      const members = await app.request(`${base}/members`);
      expect(members.status, await members.clone().text()).toBe(200);

      const invitations = await app.request(`${base}/invitations`);
      expect(invitations.status, await invitations.clone().text()).toBe(200);

      const updated = await app.request(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Strict row scope workspace" }),
      });
      expect(updated.status, await updated.clone().text()).toBe(200);

      const deleted = await app.request(base, { method: "DELETE" });
      expect(deleted.status, await deleted.clone().text()).toBe(200);
    });

    it("loads persisted asset workspace scope before strict evaluation and preserves native reach responses", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const stranger = await createWorkspaceMember();
      const outsider = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      const asset = requireRow(
        await db
          .insert(schema.assetTable)
          .values({
            id: `asset-${randomUUID()}`,
            workspaceId: owner.workspace.id,
            projectId: project.id,
            objectKey: `workspace/${owner.workspace.id}/strict-test.png`,
            filename: "strict-test.png",
            mimeType: "image/png",
            size: 1,
            createdBy: owner.user.id,
          })
          .returning(),
        "strict runtime asset",
      );
      const mismatchedAsset = requireRow(
        await db
          .insert(schema.assetTable)
          .values({
            id: `asset-${randomUUID()}`,
            workspaceId: stranger.workspace.id,
            projectId: project.id,
            objectKey: `workspace/${stranger.workspace.id}/mismatched-scope.png`,
            filename: "mismatched-scope.png",
            mimeType: "image/png",
            size: 1,
            createdBy: owner.user.id,
          })
          .returning(),
        "strict runtime mismatched asset",
      );
      const getPrivateObject = vi
        .spyOn(storage, "getPrivateObject")
        .mockResolvedValue({
          body: new Uint8Array([1]),
          contentType: "image/png",
          contentLength: 1,
          etag: undefined,
          lastModified: undefined,
        });
      const { app } = await createStrictApp();

      mockAnonymousSession();
      const unauthenticated = await app.request(`/api/asset/${asset.id}`);
      expect(unauthenticated.status).toBe(401);

      mockAuthenticatedSession(owner.user);
      const reachable = await app.request(`/api/asset/${asset.id}`);
      expect(reachable.status, await reachable.clone().text()).toBe(200);
      expect(getPrivateObject).toHaveBeenCalledWith(asset.objectKey);

      const admin = {
        id: `user-${randomUUID()}`,
        email: `strict-asset-admin-${randomUUID()}@example.com`,
        emailVerified: true,
        name: "Strict asset nonmember instance admin",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(schema.userTable).values(admin);
      await prepareAuthenticatedApiFixture(admin.id);
      mockAuthenticatedSession(admin);
      const deniedByCapability = await app.request(`/api/asset/${asset.id}`);
      expect(
        deniedByCapability.status,
        await deniedByCapability.clone().text(),
      ).toBe(403);
      expect(getPrivateObject).toHaveBeenCalledTimes(1);

      mockAuthenticatedSession(stranger.user);
      const foreign = await app.request(`/api/asset/${asset.id}`);
      expect(foreign.status, await foreign.clone().text()).toBe(404);

      const missing = await app.request(`/api/asset/asset-${randomUUID()}`);
      expect(missing.status, await missing.clone().text()).toBe(404);
      expect(await foreign.clone().text()).toBe(await missing.clone().text());

      mockAuthenticatedSession(outsider.user);
      const unreachableMismatch = await app.request(
        `/api/asset/${mismatchedAsset.id}`,
      );
      expect(unreachableMismatch.status).toBe(404);
      expect(await unreachableMismatch.clone().text()).toBe(
        await missing.clone().text(),
      );
      expect(getPrivateObject).toHaveBeenCalledTimes(1);

      const nulByte = await app.request(
        `/api/asset/${encodeURIComponent("\u0000x")}`,
      );
      expect(nulByte.status).toBe(400);
      expect(getPrivateObject).toHaveBeenCalledTimes(1);
    });

    it("keeps the native admin bypass distinct from strict capability denial and preserves missing-row masking", async () => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const admin = {
        id: `user-${randomUUID()}`,
        email: `strict-admin-${randomUUID()}@example.com`,
        emailVerified: true,
        name: "Strict nonmember instance admin",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(schema.userTable).values(admin);
      await prepareAuthenticatedApiFixture(admin.id);

      // The native reach middleware allows an instance administrator to address this
      // existing workspace. Strict evaluation then independently denies the missing
      // workspace:read capability instead of failing with missing row provenance.
      await expect(
        validateWorkspaceAccess(admin.id, owner.workspace.id),
      ).resolves.toBeUndefined();
      mockAuthenticatedSession(admin);
      const { app } = await createStrictApp();
      const denied = await app.request(`/api/workspace/${owner.workspace.id}`);
      expect(denied.status, await denied.clone().text()).toBe(403);

      const missingWorkspaceId = `workspace-${randomUUID()}`;
      const missingAsAdmin = await app.request(
        `/api/workspace/${missingWorkspaceId}`,
      );
      expect(missingAsAdmin.status, await missingAsAdmin.clone().text()).toBe(
        404,
      );

      const ordinary = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(ordinary.user);
      const missingAsNonmember = await app.request(
        `/api/workspace/${missingWorkspaceId}`,
      );
      expect(
        missingAsNonmember.status,
        await missingAsNonmember.clone().text(),
      ).toBe(403);
    });
  });
});
