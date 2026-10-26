import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { registeredDeletionFingerprint } from "../../apps/api/src/pending-action/click-deletion-executor";
import { approveRegisteredDeletion } from "../../apps/api/src/pending-action/deletion-targets";
import { createPendingAction } from "../../apps/api/src/pending-action/service";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
  PROJECT_DELETION_ROUTE,
  projectDeletionTarget,
} from "../../apps/api/src/project/project-deletion-target";
import { insertWorkflowRule } from "../../apps/api/src/workflow-rule/repository";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";

/**
 * P0 deletion audit: `DELETE /api/project/{id}` and `DELETE /api/workspace/{workspaceId}` no
 * longer delete. Each records a typed-name + step-up pending action that only its requester
 * can approve from a current browser session. Mirrors pending-action-comment-deletion.test.ts.
 */

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(password: string, rounds: number): Promise<string>;
};

async function fixture(role: "owner" | "admin" = "owner") {
  const member = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    name: "Exact Project Name",
    slug: "EXACT",
  });
  await grantProjectManageAccess(member.user.id, project.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id)),
    "requester",
  );
  const session = requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${member.user.id}`,
        token: randomUUID(),
        userId: member.user.id,
        portal: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning(),
    "session",
  );
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const agentRequest = (url: string, body: unknown) => {
    const req = withConfiguredAgentAuthority(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return app.request(req.input, req.init);
  };
  const proof = async (pendingActionId: string) => {
    await db
      .insert(schema.accountTable)
      .values({
        id: randomUUID(),
        accountId: member.user.id,
        providerId: "credential",
        userId: member.user.id,
        password: await bcrypt.hash("delete-local-password", 4),
      })
      .onConflictDoNothing();
    const challenge = await agentRequest("/api/me/step-up/challenges", {
      kind: "pending_action",
      pendingActionId,
    });
    expect(challenge.status, await challenge.clone().text()).toBe(200);
    const data = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const verified = await agentRequest("/api/me/step-up", {
      kind: "pending_action",
      pendingActionId,
      challengeId: data.challengeId,
      nonce: data.nonce,
      method: "password",
      password: "delete-local-password",
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    return ((await verified.json()) as { token: string }).token;
  };
  const approval = (id: string, typedName?: string, stepUpToken?: string) => ({
    id,
    requesterPersonId: person.id,
    userId: member.user.id,
    sessionId: session.id,
    traceId: randomUUID(),
    typedName,
    stepUpToken,
  });
  return { member, project, columns, person, session, app, proof, approval };
}

async function project(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, id)),
    "project",
  );
}
async function pending(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, id)),
    "pending action",
  );
}

describe("project deletion through a typed-key pending action", () => {
  beforeEach(() => resetTestDatabase());

  it("the real DELETE returns 202 without mutation; only typed project key + step-up approval soft-deletes", async () => {
    const f = await fixture();
    const legacyTask = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: f.project.id,
          title: "Linked legacy task",
          columnId: f.columns.todo.id,
        })
        .returning(),
      "legacy task",
    );
    await db.insert(schema.externalLinkTable).values({
      taskId: legacyTask.id,
      resourceType: "test-source",
      externalId: "source-1",
      url: "https://example.invalid/source-1",
    });
    await db.insert(schema.workflowRuleTable).values({
      projectId: f.project.id,
      integrationType: "test",
      eventType: "work_item.created",
      columnId: f.columns.todo.id,
    });
    const response = await f.app.request(`/api/project/${f.project.id}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const action = (await response.json()) as {
      pendingActionId: string;
      confirmation: string;
      summary: Record<string, unknown>;
    };
    expect(action.confirmation).toBe("typed_name_step_up");
    expect(action.summary).toMatchObject({
      projectId: f.project.id,
      name: "EXACT",
      projectName: "Exact Project Name",
      slug: "EXACT",
      impact: {
        workItems: 0,
        legacyTasks: 1,
        members: 1,
        attachments: 0,
        workflowRules: 1,
        sourceLinks: 1,
      },
      recoveryDays: 30,
    });
    expect((await project(f.project.id)).deletedAt).toBeNull();

    // The previous display name is no longer a confirmation value.
    await expect(
      approveRegisteredDeletion(
        f.approval(action.pendingActionId, "Exact Project Name"),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // Right name, no proof: 403 step_up_required, still pending.
    await expect(
      approveRegisteredDeletion(f.approval(action.pendingActionId, "EXACT")),
    ).rejects.toMatchObject({ status: 403 });
    expect((await pending(action.pendingActionId)).state).toBe("pending");
    expect((await project(f.project.id)).deletedAt).toBeNull();

    const token = await f.proof(action.pendingActionId);
    const approved = await f.app.request(
      `/api/me/pending-actions/${action.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ typedName: "EXACT" }),
      },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    const after = await project(f.project.id);
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(after.purgeAfter).toBeInstanceOf(Date);
    expect((await pending(action.pendingActionId)).state).toBe("executed");
  });

  it("refuses an API-key origin at request time (session only)", async () => {
    const f = await fixture();
    await expect(
      createPendingAction({
        requesterPersonId: f.person.id,
        credentialType: "api_key",
        credentialId: `key-${randomUUID()}`,
        origin: "api",
        action: "delete",
        routeKey: PROJECT_DELETION_ROUTE,
        targetType: "project",
        targetIds: [f.project.id],
        actorId: f.member.user.id,
        actorType: "api_key",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("an impact change invalidates the pending deletion and is never deleted", async () => {
    const f = await fixture();
    const action = await createPendingAction({
      requesterPersonId: f.person.id,
      credentialType: "session",
      credentialId: f.session.id,
      origin: "web",
      action: "delete",
      routeKey: PROJECT_DELETION_ROUTE,
      targetType: "project",
      targetIds: [f.project.id],
      actorId: f.member.user.id,
      actorType: "person",
    });
    await db.insert(schema.workflowRuleTable).values({
      projectId: f.project.id,
      integrationType: "test",
      eventType: "work_item.created",
      columnId: f.columns.todo.id,
    });
    await expect(
      approveRegisteredDeletion(f.approval(action.pendingActionId, "EXACT")),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pending(action.pendingActionId)).invalidationReason).toBe(
      "version_changed",
    );
    expect((await project(f.project.id)).deletedAt).toBeNull();
  });

  it("invalidates a preexisting display-name confirmation instead of reinterpreting it as a key", async () => {
    const f = await fixture();
    const action = await createPendingAction({
      requesterPersonId: f.person.id,
      credentialType: "session",
      credentialId: f.session.id,
      origin: "web",
      action: "delete",
      routeKey: PROJECT_DELETION_ROUTE,
      targetType: "project",
      targetIds: [f.project.id],
      actorId: f.member.user.id,
      actorType: "person",
    });
    const currentProject = await project(f.project.id);
    const { lastTaskNumber: _counter, ...previousVersion } = currentProject;
    await db
      .update(schema.pendingActionTable)
      .set({
        payloadSummary: {
          projectId: f.project.id,
          name: "Exact Project Name",
          slug: f.project.slug,
          archived: false,
        },
        targetVersions: {
          [f.project.id]: registeredDeletionFingerprint(previousVersion),
        },
      })
      .where(eq(schema.pendingActionTable.id, action.pendingActionId));

    await expect(
      approveRegisteredDeletion(
        f.approval(action.pendingActionId, "Exact Project Name"),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pending(action.pendingActionId)).invalidationReason).toBe(
      "version_changed",
    );
    expect((await project(f.project.id)).deletedAt).toBeNull();
  });

  it("counts inherited project members in the deletion impact", async () => {
    const f = await fixture();
    const inherited = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: f.member.workspace.id,
      userId: inherited.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantProjectManageAccess(inherited.user.id, f.project.id);
    const { project: child } = await createProjectFixture({
      workspaceId: f.member.workspace.id,
      name: "Child project",
      slug: "CHILD",
    });
    await db
      .update(schema.projectTable)
      .set({ parentId: f.project.id })
      .where(eq(schema.projectTable.id, child.id));

    const target = await db.transaction((tx) =>
      projectDeletionTarget.load(tx, child.id),
    );
    expect(target?.summary.impact).toMatchObject({ members: 2 });
  });

  it("serializes a workflow-rule writer with the project deletion scope lock", async () => {
    const f = await fixture();
    const identity = await resolveIdentity({
      userId: f.member.user.id,
      credential: "session",
    });
    if (!identity)
      throw new Error("project deletion test identity did not resolve");

    let release!: () => void;
    let locked!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const continueDelete = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = db.transaction(async (tx) => {
      const loaded = await projectDeletionTarget.load(tx, f.project.id);
      if (!loaded) throw new Error("project deletion target did not load");
      locked();
      await continueDelete;
      await tx
        .update(schema.projectTable)
        .set({ deletedAt: new Date() })
        .where(eq(schema.projectTable.id, f.project.id));
    });
    await lockReady;
    const writer = insertWorkflowRule(identity, {
      projectId: f.project.id,
      integrationType: "test",
      eventType: "work_item.created",
      columnId: f.columns.todo.id,
    });
    const stateBeforeDelete = await Promise.race([
      writer.then(() => "settled" as const),
      new Promise<"waiting">((resolve) =>
        setTimeout(() => resolve("waiting"), 40),
      ),
    ]);
    expect(stateBeforeDelete).toBe("waiting");
    release();
    await holder;
    await expect(writer).resolves.toBeUndefined();
    expect(
      await db
        .select()
        .from(schema.workflowRuleTable)
        .where(eq(schema.workflowRuleTable.projectId, f.project.id)),
    ).toHaveLength(0);
  });

  it("an admin without project:delete is refused at request time", async () => {
    const f = await fixture("admin");
    const viewer = await createWorkspaceMember({ role: "viewer" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: f.member.workspace.id,
      userId: viewer.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(viewer.user);
    const response = await f.app.request(`/api/project/${f.project.id}`, {
      method: "DELETE",
    });
    expect([403, 404]).toContain(response.status);
    expect((await project(f.project.id)).deletedAt).toBeNull();
  });
});

describe("workspace deletion through a typed-name pending action", () => {
  beforeEach(() => resetTestDatabase());

  it("the real DELETE returns 202 without mutation; only typed name + step-up approval deletes", async () => {
    const f = await fixture("owner");
    const workspaceId = f.member.workspace.id;
    const response = await f.app.request(`/api/workspace/${workspaceId}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const action = (await response.json()) as {
      pendingActionId: string;
      confirmation: string;
    };
    expect(action.confirmation).toBe("typed_name_step_up");
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId)),
    ).toHaveLength(1);

    const token = await f.proof(action.pendingActionId);
    await approveRegisteredDeletion(
      f.approval(action.pendingActionId, f.member.workspace.name, token),
    );
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId)),
    ).toHaveLength(0);
    expect((await pending(action.pendingActionId)).state).toBe("executed");
  });

  it("cancellation preserves the workspace", async () => {
    const f = await fixture("owner");
    const workspaceId = f.member.workspace.id;
    const response = await f.app.request(`/api/workspace/${workspaceId}`, {
      method: "DELETE",
    });
    const action = (await response.json()) as { pendingActionId: string };
    const cancelled = await f.app.request(
      `/api/me/pending-actions/${action.pendingActionId}/cancel`,
      { method: "POST" },
    );
    expect(cancelled.status).toBe(200);
    await expect(
      approveRegisteredDeletion(
        f.approval(action.pendingActionId, f.member.workspace.name),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId)),
    ).toHaveLength(1);
  });
});

describe("workspace deletion respects an open legal hold (PA-12)", () => {
  beforeEach(() => resetTestDatabase());

  async function requestDeletion(f: Awaited<ReturnType<typeof fixture>>) {
    const response = await f.app.request(
      `/api/workspace/${f.member.workspace.id}`,
      { method: "DELETE" },
    );
    expect(response.status, await response.clone().text()).toBe(202);
    return ((await response.json()) as { pendingActionId: string })
      .pendingActionId;
  }
  const workspaceRows = (id: string) =>
    db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));

  for (const scope of ["organisation", "person"] as const) {
    it(`an open ${scope} hold refuses the approved deletion with 409 legal_hold; the workspace survives and the action stays pending`, async () => {
      const f = await fixture("owner");
      const id = await requestDeletion(f);
      await db.insert(schema.legalHoldTable).values({
        scope,
        scopeId:
          scope === "organisation"
            ? f.member.workspace.organisationId
            : f.person.id,
        placedBy: "compliance-officer",
        reason: "litigation",
      });
      const token = await f.proof(id);
      await expect(
        approveRegisteredDeletion(
          f.approval(id, f.member.workspace.name, token),
        ),
      ).rejects.toMatchObject({ status: 409, message: "legal_hold" });
      expect(await workspaceRows(f.member.workspace.id)).toHaveLength(1);
      expect((await pending(id)).state).toBe("pending");
    });
  }

  it("a lifted hold does not block the deletion", async () => {
    const f = await fixture("owner");
    const id = await requestDeletion(f);
    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: f.member.workspace.organisationId,
      placedBy: "compliance-officer",
      reason: "closed matter",
      liftedBy: "compliance-officer",
      liftedAt: new Date(),
    });
    const token = await f.proof(id);
    await approveRegisteredDeletion(
      f.approval(id, f.member.workspace.name, token),
    );
    expect(await workspaceRows(f.member.workspace.id)).toHaveLength(0);
    expect((await pending(id)).state).toBe("executed");
  });
});
