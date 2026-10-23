import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  approveCommentDeletion,
  COMMENT_DELETION_ROUTE,
} from "../../apps/api/src/pending-action/comment-deletion-target";
import {
  createPendingAction,
  decideOwnPendingAction,
  getOwnPendingAction,
} from "../../apps/api/src/pending-action/service";
import { mockAuthenticatedSession } from "./helpers/auth";
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
      "comment:delete_own",
      "comment:delete_any",
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
        id: `session-${member.user.id}`,
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
      .insert(schema.commentTable)
      .values({
        workspaceId: source.workspaceId,
        workItemId: source.id,
        authorId: person.id,
        actorType: "person",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Exact comment kept until approval" },
              ],
            },
          ],
        },
        visibility: "internal",
      })
      .returning(),
    "comment",
  );
  const request = {
    requesterPersonId: person.id,
    credentialType: "session" as const,
    credentialId: session.id,
    origin: "web" as const,
    action: "delete" as const,
    routeKey: COMMENT_DELETION_ROUTE,
    targetType: "comment",
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
async function comment(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id)),
    "comment",
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

describe("canonical comment durable deletion", () => {
  beforeEach(() => resetTestDatabase());
  it("the real DELETE returns202 without mutation and only real approval tombstones", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.member.user);
    const { app } = createApp();
    const response = await app.request(`/api/comments/${f.relation.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(202);
    const action = (await response.json()) as { pendingActionId: string };
    expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
    const approved = await app.request(
      `/api/me/pending-actions/${action.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approved.status).toBe(200);
    expect((await comment(f.relation.id)).body).toBeNull();
  });
  it("keeps exact body until approval, preserves history/tombstone, and executes once under concurrent confirmation", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
    expect(action.summary).toMatchObject({
      commentId: f.relation.id,
      key: f.source.key,
      commentBody: f.relation.body,
    });
    const outcomes = await Promise.allSettled([
      approveCommentDeletion(f.approval(action.pendingActionId)),
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await comment(f.relation.id)).toMatchObject({
      body: null,
      deletedBy: f.member.user.id,
      authorId: f.person.id,
    });
    expect((await comment(f.relation.id)).deletedAt).toBeInstanceOf(Date);
    expect((await pending(action.pendingActionId)).state).toBe("executed");
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityId, f.relation.id),
            eq(schema.auditLogTable.action, "comment.deleted"),
          ),
        ),
    ).toHaveLength(1);
  });
  it("invalidates an edited comment and never deletes its newer body", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db
      .update(schema.commentTable)
      .set({ body: { type: "doc", content: [] }, editedAt: new Date() })
      .where(eq(schema.commentTable.id, f.relation.id));
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pending(action.pendingActionId)).invalidationReason).toBe(
      "version_changed",
    );
    expect((await comment(f.relation.id)).body).toEqual({
      type: "doc",
      content: [],
    });
  });
  it("detects even a same-body edit via immutable history revision", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db.insert(schema.commentVersionTable).values({
      commentId: f.relation.id,
      body: f.relation.body,
      editedBy: f.member.user.id,
      number: 1,
    });
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await comment(f.relation.id)).deletedAt).toBeNull();
  });
  it("cancellation and expiry preserve the comment", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await decideOwnPendingAction({
      id: action.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.session.id,
    });
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    const next = await createPendingAction(f.request);
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingActionTable.id, next.pendingActionId));
    expect(
      await approveCommentDeletion(f.approval(next.pendingActionId)),
    ).toMatchObject({ state: "expired" });
    expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
  });
  it("lost read reach redacts the summary and invalidates approval", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, f.person.id),
          eq(schema.membershipTable.scopeId, f.source.projectId),
        ),
      );
    const read = await getOwnPendingAction(
      f.member.user.id,
      action.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(read).toMatchObject({
      summary: { redacted: true, targetCount: 1 },
      targetIds: [],
    });
    expect(JSON.stringify(read)).not.toContain("Exact comment");
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await comment(f.relation.id)).deletedAt).toBeNull();
  });
  it("a revoked original session cannot be replaced by a new approving session", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    const replacement = requireRow(
      await db
        .insert(schema.sessionTable)
        .values({
          id: randomUUID(),
          token: randomUUID(),
          userId: f.member.user.id,
          portal: "agent",
          expiresAt: new Date(Date.now() + 3600000),
        })
        .returning(),
      "replacement",
    );
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.id, f.session.id));
    await expect(
      approveCommentDeletion({
        ...f.approval(action.pendingActionId),
        sessionId: replacement.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pending(action.pendingActionId)).invalidationReason).toBe(
      "credential_revoked",
    );
    expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
  });
  it("parent changes invalidate the exact confirmation; already deleted authorized targets are safe no-ops", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db
      .update(schema.workItemTable)
      .set({ version: f.source.version + 1 })
      .where(eq(schema.workItemTable.id, f.source.id));
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    await db
      .update(schema.commentTable)
      .set({ body: null, deletedAt: new Date(), deletedBy: f.member.user.id })
      .where(eq(schema.commentTable.id, f.relation.id));
    const next = await createPendingAction(f.request);
    const before = await comment(f.relation.id);
    await approveCommentDeletion(f.approval(next.pendingActionId));
    expect(await comment(f.relation.id)).toEqual(before);
  });
  it.each(["disabled", "ceiling"])(
    "revalidates original API key %s independently of the approving session",
    async (change) => {
      const f = await fixture();
      const key = requireRow(
        await db
          .insert(schema.apikeyTable)
          .values({
            id: randomUUID(),
            key: randomUUID(),
            userId: f.member.user.id,
            referenceId: f.member.user.id,
            name: "comment deletion key",
            enabled: true,
            permissions: JSON.stringify({
              project: ["read"],
              work_item: ["read"],
              comment: ["delete_own"],
            }),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning(),
        "key",
      );
      const request = {
        ...f.request,
        credentialType: "api_key" as const,
        credentialId: key.id,
        origin: "api" as const,
        actorType: "api_key" as const,
      };
      const action = await createPendingAction(request);
      await db
        .update(schema.apikeyTable)
        .set(
          change === "disabled"
            ? { enabled: false }
            : {
                permissions: JSON.stringify({
                  project: ["read"],
                  work_item: ["read"],
                }),
              },
        )
        .where(eq(schema.apikeyTable.id, key.id));
      await expect(
        approveCommentDeletion(f.approval(action.pendingActionId)),
      ).rejects.toMatchObject({ status: 409 });
      expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
      await expect(createPendingAction(request)).rejects.toMatchObject({
        status: 403,
      });
    },
  );
  it("current moderation removal and archived parent both preserve the body", async () => {
    const f = await fixture();
    const other = await createWorkspaceMember({ role: "member" });
    const otherPerson = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, other.user.id)),
      "other author",
    );
    await db
      .update(schema.commentTable)
      .set({ authorId: otherPerson.id })
      .where(eq(schema.commentTable.id, f.relation.id));
    // Member is not a moderator even when a project grant contains the any capability.
    await expect(createPendingAction(f.request)).rejects.toMatchObject({
      status: 403,
    });
    await db
      .update(schema.commentTable)
      .set({ authorId: f.person.id })
      .where(eq(schema.commentTable.id, f.relation.id));
    const action = await createPendingAction(f.request);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, f.source.projectId));
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
  });
  it("refuses originating impersonation and inactive requester credentials", async () => {
    const f = await fixture();
    await db
      .update(schema.sessionTable)
      .set({ impersonatedBy: "instance-admin" })
      .where(eq(schema.sessionTable.id, f.session.id));
    await expect(createPendingAction(f.request)).rejects.toMatchObject({
      status: 403,
    });
    await db
      .update(schema.sessionTable)
      .set({ impersonatedBy: null })
      .where(eq(schema.sessionTable.id, f.session.id));
    const action = await createPendingAction(f.request);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, f.person.id));
    await expect(
      approveCommentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pending(action.pendingActionId)).invalidationReason).toBe(
      "requester_deactivated",
    );
    expect((await comment(f.relation.id)).body).toEqual(f.relation.body);
  });
  it("executed confirmation detail/list never retain a deleted body's public preview and scrub only mutable summary storage", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.member.user);
    const { app } = createApp();
    const action = await createPendingAction(f.request);
    const before = await pending(action.pendingActionId);
    expect(before.payloadSummary).toMatchObject({
      commentBody: f.relation.body,
      alreadyDeleted: false,
    });
    const live = await app.request(
      `/api/me/pending-actions/${action.pendingActionId}`,
    );
    expect(JSON.stringify(await live.json())).toContain(
      "Exact comment kept until approval",
    );
    await approveCommentDeletion(f.approval(action.pendingActionId));
    const after = await pending(action.pendingActionId);
    expect(after.payloadSummary).toMatchObject({
      commentBody: null,
      alreadyDeleted: true,
    });
    expect(after.payload).toEqual(before.payload);
    expect(after.targetVersions).toEqual(before.targetVersions);
    expect(after.payloadHash).toBe(before.payloadHash);
    for (const url of [
      `/api/me/pending-actions/${action.pendingActionId}`,
      "/api/me/pending-actions",
    ]) {
      const response = await app.request(url);
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        summary?: unknown;
        data?: Array<{ summary: unknown }>;
      };
      const summary = data.summary ?? data.data?.[0]?.summary;
      if (data.summary)
        expect(summary).toMatchObject({
          commentId: f.relation.id,
          key: f.source.key,
          title: f.source.title,
          alreadyDeleted: true,
          commentBody: null,
        });
      else expect(data.data).toEqual([]); // The queue lists pending actions only.
      expect(JSON.stringify(data)).not.toContain(
        "Exact comment kept until approval",
      );
    }
  });
  it.each(["pending", "cancelled", "expired"])(
    "a historical %s preview is suppressed as soon as the comment is deleted elsewhere",
    async (state) => {
      const f = await fixture();
      mockAuthenticatedSession(f.member.user);
      const { app } = createApp();
      const action = await createPendingAction(f.request);
      if (state !== "pending")
        await db
          .update(schema.pendingActionTable)
          .set({ state })
          .where(eq(schema.pendingActionTable.id, action.pendingActionId));
      await db
        .update(schema.commentTable)
        .set({ deletedAt: new Date(), deletedBy: f.member.user.id, body: null })
        .where(eq(schema.commentTable.id, f.relation.id));
      // A historical database summary can still contain the original preview; projection must consult the live target.
      expect(
        (await pending(action.pendingActionId)).payloadSummary,
      ).toMatchObject({ commentBody: f.relation.body, alreadyDeleted: false });
      for (const url of [
        `/api/me/pending-actions/${action.pendingActionId}`,
        "/api/me/pending-actions",
      ]) {
        const response = await app.request(url);
        expect(response.status).toBe(200);
        const data = (await response.json()) as {
          summary?: unknown;
          data?: Array<{ summary: unknown }>;
        };
        if (data.summary || state === "pending")
          expect(data.summary ?? data.data?.[0]?.summary).toMatchObject({
            alreadyDeleted: true,
            commentBody: null,
          });
        else expect(data.data).toEqual([]);
        expect(JSON.stringify(data)).not.toContain(
          "Exact comment kept until approval",
        );
      }
      if (state === "pending")
        await expect(
          approveCommentDeletion(f.approval(action.pendingActionId)),
        ).rejects.toMatchObject({ status: 409 });
    },
  );
  it("an old executed row is projected safely without a backfill, and lost reach still redacts parent and identity", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.member.user);
    const { app } = createApp();
    const action = await createPendingAction(f.request);
    await approveCommentDeletion(f.approval(action.pendingActionId));
    // Model an executed record written by the former release: immutable history remains unchanged.
    await db
      .update(schema.pendingActionTable)
      .set({
        payloadSummary: {
          commentId: f.relation.id,
          key: f.source.key,
          title: f.source.title,
          commentBody: f.relation.body,
          alreadyDeleted: false,
        },
      })
      .where(eq(schema.pendingActionTable.id, action.pendingActionId));
    const read = await app.request(
      `/api/me/pending-actions/${action.pendingActionId}`,
    );
    expect(((await read.json()) as { summary: unknown }).summary).toMatchObject(
      { alreadyDeleted: true, commentBody: null },
    );
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, f.person.id),
          eq(schema.membershipTable.scopeId, f.source.projectId),
        ),
      );
    const hidden = await app.request(
      `/api/me/pending-actions/${action.pendingActionId}`,
    );
    const body = (await hidden.json()) as {
      summary: unknown;
      targetIds: string[];
    };
    expect(body).toMatchObject({
      summary: { redacted: true, targetCount: 1 },
      targetIds: [],
    });
    expect(JSON.stringify(body)).not.toContain("Exact comment");
    expect(JSON.stringify(body)).not.toContain(f.source.key);
  });
});
