import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { workItemRelationTable } from "../../apps/api/src/database/schema";
import {
  approveRelationDeletion,
  RELATION_DELETION_ROUTE,
} from "../../apps/api/src/pending-action/relation-deletion-target";
import {
  createPendingAction,
  decideOwnPendingAction,
  getOwnPendingAction,
  getOwnPendingActions,
} from "../../apps/api/src/pending-action/service";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

async function fixture() {
  const member = await createWorkspaceMember({ role: "member" });
  const sourceProject = (
    await createProjectFixture({ workspaceId: member.workspace.id })
  ).project;
  const targetProject = (
    await createProjectFixture({ workspaceId: member.workspace.id })
  ).project;
  for (const project of [sourceProject, targetProject])
    await grantProjectRole(member.user.id, project.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
    ]);
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
        id: randomUUID(),
        token: randomUUID(),
        userId: member.user.id,
        portal: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning(),
    "session",
  );
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: member.workspace.id,
        key: `state-${randomUUID()}`,
        name: "To Do",
        group: "unstarted",
      })
      .returning(),
    "template",
  );
  const item = async (project: typeof sourceProject) => {
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: template.id,
          isDefault: true,
        })
        .returning(),
      "state",
    );
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          projectId: project.id,
          workspaceId: member.workspace.id,
          typeId: type.id,
          number: 1,
          key: `${project.slug}-1`,
          title: "Relation approval fixture",
          stateId: state.id,
        })
        .returning(),
      "item",
    );
  };
  const source = await item(sourceProject);
  const target = await item(targetProject);
  const relation = requireRow(
    await db
      .insert(workItemRelationTable)
      .values({
        sourceId: source.id,
        targetId: target.id,
        type: "relates",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(),
    "relation",
  );
  const request = {
    requesterPersonId: person.id,
    credentialType: "session" as const,
    credentialId: session.id,
    origin: "web" as const,
    action: "delete" as const,
    routeKey: RELATION_DELETION_ROUTE,
    targetType: "relation",
    targetIds: [relation.id],
    workspaceId: member.workspace.id,
    actorId: member.user.id,
    actorType: "person" as const,
  };
  const approval = (id: string) => ({
    id,
    requesterPersonId: person.id,
    userId: member.user.id,
    sessionId: session.id,
    traceId: randomUUID(),
  });
  return {
    member,
    person,
    session,
    source,
    target,
    relation,
    request,
    approval,
  };
}
async function relationExists(id: string) {
  return (
    (
      await db
        .select({ id: workItemRelationTable.id })
        .from(workItemRelationTable)
        .where(eq(workItemRelationTable.id, id))
    ).length === 1
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

describe("canonical relation deletion pending-action execution", () => {
  beforeEach(() => resetTestDatabase());
  it("persists a click approval before mutation, executes exactly once and journals both ends", async () => {
    const f = await fixture();
    const created = await createPendingAction(f.request);
    expect(await relationExists(f.relation.id)).toBe(true);
    const saved = await pending(created.pendingActionId);
    expect(saved).toMatchObject({
      targetType: "relation",
      state: "pending",
      confirmationRequired: "click",
      workspaceId: f.source.workspaceId,
      projectId: f.source.projectId,
    });
    expect(saved.targetVersions).toBeTruthy();
    const approvals = await Promise.allSettled([
      approveRelationDeletion(f.approval(saved.id)),
      approveRelationDeletion(f.approval(saved.id)),
    ]);
    expect(
      approvals.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await relationExists(f.relation.id)).toBe(false);
    expect((await pending(saved.id)).state).toBe("executed");
    const activities = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.field, "relation"));
    expect(activities).toHaveLength(2);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, saved.id));
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      "pending_action.decided",
      "pending_action.executed",
      "pending_action.requested",
    ]);
  });
  it("expires without deleting and refuses cancelled approvals", async () => {
    const f = await fixture();
    const created = await createPendingAction(f.request);
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingActionTable.id, created.pendingActionId));
    expect(
      await approveRelationDeletion(f.approval(created.pendingActionId)),
    ).toMatchObject({ state: "expired" });
    expect(await relationExists(f.relation.id)).toBe(true);
    const next = await createPendingAction(f.request);
    await decideOwnPendingAction({
      id: next.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.session.id,
    });
    await expect(
      approveRelationDeletion(f.approval(next.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
  it("requires current update authority and reach on the peer at request and approval", async () => {
    const f = await fixture();
    const membership = requireRow(
      await db
        .select()
        .from(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, f.person.id),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, f.target.projectId),
          ),
        ),
      "peer membership",
    );
    const created = await createPendingAction(f.request);
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read", "work_item:read"] })
      .where(eq(schema.roleTable.id, membership.roleId));
    await expect(
      approveRelationDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 404 }); // PA-6 step 2: the approver lost access
    expect(await pending(created.pendingActionId)).toMatchObject({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    await expect(createPendingAction(f.request)).rejects.toMatchObject({
      status: 403,
    });
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.id, membership.id));
    await expect(createPendingAction(f.request)).rejects.toMatchObject({
      status: 404,
    });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
  it("invalidates when either endpoint changes after the summary was approved", async () => {
    const f = await fixture();
    const created = await createPendingAction(f.request);
    await db
      .update(schema.workItemTable)
      .set({ title: "Changed after request", version: f.target.version + 1 })
      .where(eq(schema.workItemTable.id, f.target.id));
    await expect(
      approveRelationDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(await pending(created.pendingActionId)).toMatchObject({
      state: "invalidated",
      invalidationReason: "version_changed",
    });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
  it("refuses foreign workspace assertions and unrelated requesters without revealing relation details", async () => {
    const f = await fixture();
    const other = await createWorkspaceMember();
    await expect(
      createPendingAction({ ...f.request, workspaceId: other.workspace.id }),
    ).rejects.toMatchObject({ status: 404 });
    const otherPerson = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, other.user.id)),
      "other person",
    );
    const created = await createPendingAction(f.request);
    await expect(
      approveRelationDeletion({
        ...f.approval(created.pendingActionId),
        requesterPersonId: otherPerson.id,
        userId: other.user.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
  it("requires a current agent session and rejects tampered canonical payloads", async () => {
    const f = await fixture();
    const created = await createPendingAction(f.request);
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessionTable.id, f.session.id));
    await expect(
      approveRelationDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.sessionTable.id, f.session.id));
    await db
      .update(schema.pendingActionTable)
      .set({ payloadHash: "0".repeat(64) })
      .where(eq(schema.pendingActionTable.id, created.pendingActionId));
    await expect(
      approveRelationDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
  it("retains the originating API key ceiling and does not turn a key request into session authority", async () => {
    const f = await fixture();
    const keyId = randomUUID();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      userId: f.member.user.id,
      referenceId: f.member.user.id,
      key: randomUUID(),
      enabled: true,
      permissions: JSON.stringify({ work_item: ["update"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const created = await createPendingAction({
      ...f.request,
      credentialType: "api_key",
      credentialId: keyId,
      origin: "api",
      actorType: "api_key",
    });
    expect(await relationExists(f.relation.id)).toBe(true);
    await db
      .update(schema.apikeyTable)
      .set({ permissions: JSON.stringify({ work_item: ["read"] }) })
      .where(eq(schema.apikeyTable.id, keyId));
    await expect(
      approveRelationDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(await pending(created.pendingActionId)).toMatchObject({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
  it("does not disclose either endpoint through pending detail/list after peer read or reach loss", async () => {
    const f = await fixture();
    const created = await createPendingAction(f.request);
    const context = { apiKeyId: null, traceId: randomUUID() };
    const before = await getOwnPendingAction(
      f.member.user.id,
      created.pendingActionId,
      undefined,
      context,
    );
    expect(before.summary).toMatchObject({
      sourceKey: f.source.key,
      targetKey: f.target.key,
    });
    const peerMembership = requireRow(
      await db
        .select()
        .from(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, f.person.id),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, f.target.projectId),
          ),
        ),
      "peer membership",
    );
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read"] })
      .where(eq(schema.roleTable.id, peerMembership.roleId));
    const detail = await getOwnPendingAction(
      f.member.user.id,
      created.pendingActionId,
      undefined,
      context,
    );
    expect(detail.summary).toEqual({ redacted: true, targetCount: 1 });
    expect(detail.approvalSupported).toBe(false);
    const listed = await getOwnPendingActions(
      f.member.user.id,
      { limit: 50 },
      undefined,
      context,
    );
    expect(listed.data[0]?.summary).toEqual({ redacted: true, targetCount: 1 });
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read", "work_item:update"] })
      .where(eq(schema.roleTable.id, peerMembership.roleId));
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.id, peerMembership.id));
    const unreachable = await getOwnPendingAction(
      f.member.user.id,
      created.pendingActionId,
      undefined,
      context,
    );
    expect(unreachable.summary).toEqual({ redacted: true, targetCount: 1 });
    expect(JSON.stringify(unreachable)).not.toContain(f.target.key);
  });
  it("cannot bypass the frozen both-end snapshot by removing targetVersions", async () => {
    const f = await fixture();
    const created = await createPendingAction(f.request);
    await db
      .update(schema.pendingActionTable)
      .set({ targetVersions: null })
      .where(eq(schema.pendingActionTable.id, created.pendingActionId));
    await expect(
      approveRelationDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(await pending(created.pendingActionId)).toMatchObject({
      state: "invalidated",
      invalidationReason: "version_changed",
    });
    expect(await relationExists(f.relation.id)).toBe(true);
  });
});
