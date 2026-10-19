import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import createColumn, {
  toSlug,
} from "../../apps/api/src/column/controllers/create-column";
import reorderColumns from "../../apps/api/src/column/controllers/reorder-columns";
import {
  findColumnById,
  insertColumn,
  updateColumnById,
  updateColumnPositionInProject,
} from "../../apps/api/src/column/repository";
import { listTaskCommentRows } from "../../apps/api/src/comment/repository";
import db, { schema } from "../../apps/api/src/database";
import { listExternalLinksByTask } from "../../apps/api/src/external-link/repository";
import { reachableLinkedWorkItemId } from "../../apps/api/src/intake/submission-linked-work-item";
import { findCustomProviderIdToken } from "../../apps/api/src/oauth/repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
  deleteWorkflowRuleById,
  findWorkflowRuleById,
  insertWorkflowRule,
  updateWorkflowRuleColumn,
} from "../../apps/api/src/workflow-rule/repository";
import {
  findLiveWorkItemSocketScope,
  findReachableLiveProject,
} from "../../apps/api/src/ws/repository";
import { addCustomer, buildTenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";
import { seedIntake, submissionRow, submitAs } from "./helpers/intake-http";

beforeEach(async () => {
  await resetTestDatabase();
});

async function seedTask(projectId: string, columnId: string, number = 1) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Repository task",
        status: "to-do",
        columnId,
        priority: "medium",
        number,
        position: number,
      })
      .returning(),
    "seed leaf repository task",
  );
}

describe("current leaf repository reach", () => {
  it("requires resolved identity and current SQL reach for linked-work-item facts", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("test caller identity did not resolve");

    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `linked-reach-${randomUUID()}`,
          name: "Linked reach test item",
          category: "service",
        })
        .returning(),
      "linked reach work item type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: member.workspace.id,
          key: `linked-reach-state-${randomUUID()}`,
          name: "Open",
          group: "backlog",
        })
        .returning(),
      "linked reach state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: template.id,
          isDefault: true,
        })
        .returning(),
      "linked reach state",
    );
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          projectId: project.id,
          workspaceId: member.workspace.id,
          typeId: type.id,
          stateId: state.id,
          number: 1,
          key: `${project.slug}-1`,
          title: "Linked reach test item",
        })
        .returning(),
      "linked reach work item",
    );

    let reachChecks = 0;
    const allowedReach = {
      reaches: async (row: {
        projectId: string;
        workspaceId: string;
        organisationId: string | null;
      }) => {
        reachChecks += 1;
        expect(row).toMatchObject({
          projectId: project.id,
          workspaceId: member.workspace.id,
        });
        return true;
      },
    };
    expect(
      await reachableLinkedWorkItemId(identity, allowedReach, item.id),
    ).toBe(item.id);

    expect(
      await reachableLinkedWorkItemId(
        identity,
        { reaches: async () => false },
        item.id,
      ),
    ).toBeNull();

    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    if (!person) throw new Error("test person was not provisioned");
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );

    expect(
      await reachableLinkedWorkItemId(identity, allowedReach, item.id),
    ).toBeNull();
    expect(reachChecks).toBe(1);
    expect(
      await reachableLinkedWorkItemId(null, allowedReach, item.id),
    ).toBeNull();
    expect(
      await reachableLinkedWorkItemId(identity, allowedReach, null),
    ).toBeNull();
    expect(reachChecks).toBe(1);
  });

  it("reads only the authenticated user's custom-provider id token", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const other = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.accountTable).values([
      {
        id: `custom-${randomUUID()}`,
        accountId: "custom-account",
        providerId: "custom",
        userId: member.user.id,
        idToken: "custom-token",
      },
      {
        id: `github-${randomUUID()}`,
        accountId: "github-account",
        providerId: "github",
        userId: member.user.id,
        idToken: "github-token",
      },
      {
        id: `other-${randomUUID()}`,
        accountId: "other-account",
        providerId: "custom",
        userId: other.user.id,
        idToken: "other-token",
      },
    ]);

    expect(await findCustomProviderIdToken(member.user.id)).toBe(
      "custom-token",
    );
    expect(await findCustomProviderIdToken("missing-user")).toBeNull();
  });

  it("defaults intake submission visibility from the requester's organization", async () => {
    const seeded = await seedIntake(`leaf-visibility-${randomUUID()}`);
    const requesterTenant = await buildTenant(
      `leaf-visibility-requester-${randomUUID()}`,
    );
    const requester = await addCustomer(requesterTenant);
    expect(requester.orgId).not.toBe(seeded.customer.orgId);
    // Opposite defaults distinguish requester identity from the project organization.
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: requester.orgId,
      requestTypeId: seeded.requestType.id,
    });

    for (const [requesterVisibility, tenantVisibility] of [
      ["private", "organisation"],
      ["organisation", "private"],
    ] as const) {
      await db
        .update(schema.organisationTable)
        .set({ defaultCustomerVisibility: tenantVisibility })
        .where(eq(schema.organisationTable.id, seeded.customer.orgId));
      await db
        .update(schema.organisationTable)
        .set({ defaultCustomerVisibility: requesterVisibility })
        .where(eq(schema.organisationTable.id, requester.orgId));
      const reference = await submitAs(
        seeded,
        requester,
        `Visibility ${requesterVisibility}`,
      );
      const submission = await submissionRow(reference);
      expect(submission.organisationId).toBe(requester.orgId);
      expect(submission.requesterId).toBe(requester.person.id);
      expect(submission.customerVisibility).toBe(requesterVisibility);
    }
  });

  it("returns websocket scope only for live work items in currently reached projects", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const live = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const archived = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const deleted = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const unreached = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, live.project.id);
    await grantProjectManageAccess(member.user.id, archived.project.id);
    await grantProjectManageAccess(member.user.id, deleted.project.id);

    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("test caller identity did not resolve");

    const now = new Date();
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `socket-type-${randomUUID()}`,
          name: "Socket item",
          category: "delivery",
        })
        .returning(),
      "socket work-item type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: member.workspace.id,
          key: `socket-state-${randomUUID()}`,
          name: "Open",
          group: "backlog",
        })
        .returning(),
      "socket state template",
    );
    async function seedSocketItem(
      projectId: string,
      number: number,
      overrides: Partial<typeof schema.workItemTable.$inferInsert> = {},
    ) {
      const state = requireRow(
        await db
          .insert(schema.stateTable)
          .values({
            projectId,
            stateTemplateId: template.id,
            isDefault: false,
          })
          .returning(),
        "socket state",
      );
      const key = `SOCK-${randomUUID().slice(0, 8)}`;
      await db.insert(schema.workItemTable).values({
        workspaceId: member.workspace.id,
        projectId,
        typeId: type.id,
        stateId: state.id,
        number,
        key,
        title: "Socket scope test item",
        createdAt: now,
        updatedAt: now,
        ...overrides,
      });
      return key;
    }

    const liveKey = await seedSocketItem(live.project.id, 1);
    const archivedItemKey = await seedSocketItem(live.project.id, 2, {
      archivedAt: now,
    });
    const deletedItemKey = await seedSocketItem(live.project.id, 3, {
      deletedAt: now,
    });
    const archivedProjectKey = await seedSocketItem(archived.project.id, 1);
    const deletedProjectKey = await seedSocketItem(deleted.project.id, 1);
    const unreachedProjectKey = await seedSocketItem(unreached.project.id, 1);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: now })
      .where(eq(schema.projectTable.id, archived.project.id));
    await db
      .update(schema.projectTable)
      .set({ deletedAt: now, purgeAfter: now })
      .where(eq(schema.projectTable.id, deleted.project.id));

    expect(
      await findReachableLiveProject(identity, live.project.id),
    ).toMatchObject({ workspaceId: member.workspace.id });
    expect(
      await findReachableLiveProject(identity, archived.project.id),
    ).toBeUndefined();
    expect(
      await findReachableLiveProject(identity, deleted.project.id),
    ).toBeUndefined();
    expect(
      await findReachableLiveProject(identity, unreached.project.id),
    ).toBeUndefined();

    expect(await findLiveWorkItemSocketScope(identity, liveKey)).toMatchObject({
      projectId: live.project.id,
      workspaceId: member.workspace.id,
    });
    for (const key of [
      archivedItemKey,
      deletedItemKey,
      archivedProjectKey,
      deletedProjectKey,
      unreachedProjectKey,
      "SOCK-missing",
    ]) {
      expect(await findLiveWorkItemSocketScope(identity, key)).toBeUndefined();
    }
  });

  it("keeps positive comment/link reads and blocks content and DML after persisted reach revocation", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("test caller identity did not resolve");

    const task = await seedTask(project.id, columns.todo.id);
    const siblingTask = await seedTask(project.id, columns.todo.id, 2);
    await db.insert(schema.taskActivityTable).values([
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: "second comment",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: "first comment",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        taskId: siblingTask.id,
        type: "comment",
        userId: member.user.id,
        content: "sibling-task comment",
      },
      {
        taskId: task.id,
        type: "task",
        userId: member.user.id,
        content: "not a comment",
      },
      { taskId: task.id, type: "comment", userId: null, content: "orphan" },
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: null,
      },
    ]);
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      resourceType: "issue",
      externalId: "external-own",
      url: "https://example.test/issue/own",
    });
    await db.insert(schema.externalLinkTable).values({
      taskId: siblingTask.id,
      resourceType: "issue",
      externalId: "external-sibling",
      url: "https://example.test/issue/sibling",
    });

    const comments = await listTaskCommentRows(identity, task.id);
    expect(comments.map((row) => row.content)).toEqual([
      "first comment",
      "second comment",
    ]);
    expect(comments[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      userName: member.user.name,
      content: "first comment",
    });
    const links = await listExternalLinksByTask(identity, task.id);
    expect(links.map((row) => row.externalId)).toEqual(["external-own"]);
    expect(await findColumnById(identity, columns.todo.id)).toBeDefined();

    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    if (!person) throw new Error("test person was not provisioned");
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );

    expect(await listTaskCommentRows(identity, task.id)).toEqual([]);
    expect(await listExternalLinksByTask(identity, task.id)).toEqual([]);
    expect(
      await updateColumnById(identity, columns.todo.id, { name: "Revoked" }),
    ).toBeUndefined();
    const revokedInsertSlug = `must-not-insert-${randomUUID()}`;
    expect(
      await insertColumn(identity, {
        projectId: project.id,
        name: "Must not insert",
        slug: revokedInsertSlug,
        position: 50,
        icon: null,
        color: null,
        isFinal: false,
      }),
    ).toBeUndefined();

    const [unchanged] = await db
      .select({ name: schema.columnTable.name })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, columns.todo.id))
      .limit(1);
    expect(unchanged?.name).toBe(columns.todo.name);
    const [notInserted] = await db
      .select({ id: schema.columnTable.id })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.slug, revokedInsertSlug))
      .limit(1);
    expect(notInserted).toBeUndefined();
  });

  it("preserves Unicode slug normalization, default column values, and project-local reorder scope", async () => {
    expect(toSlug("  Ａccent / B  ")).toBe("accent-b");
    expect(toSlug("---")).toBe("");

    const member = await createWorkspaceMember({ role: "admin" });
    const first = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const second = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, first.project.id);
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("test caller identity did not resolve");

    const created = await createColumn({
      identity,
      projectId: first.project.id,
      name: "Ａccent / B",
    });
    expect(created).toMatchObject({
      slug: "accent-b",
      icon: null,
      color: null,
      isFinal: false,
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
    expect(
      await updateColumnPositionInProject(
        identity,
        first.project.id,
        second.columns.todo.id,
        99,
      ),
    ).toBeUndefined();
    await expect(
      reorderColumns(identity, first.project.id, [
        { id: first.columns.todo.id, position: 99 },
        { id: second.columns.todo.id, position: 100 },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    const [foreign] = await db
      .select({ position: schema.columnTable.position })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, second.columns.todo.id))
      .limit(1);
    expect(foreign?.position).toBe(second.columns.todo.position);
    const [local] = await db
      .select({ position: schema.columnTable.position })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, first.columns.todo.id))
      .limit(1);
    expect(local?.position).toBe(first.columns.todo.position);
  });

  it("uses the returned current-reach result for workflow-rule writes", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    const identity = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("test caller identity did not resolve");
    const rule = await insertWorkflowRule(identity, {
      projectId: project.id,
      integrationType: "github",
      eventType: "pull_request_opened",
      columnId: columns.todo.id,
    });
    if (!rule) throw new Error("workflow rule was not inserted");
    expect(rule.id).toBeTruthy();
    expect(rule.createdAt).toBeInstanceOf(Date);
    expect(rule.updatedAt).toBeInstanceOf(Date);

    expect(await findWorkflowRuleById(identity, rule.id)).toBeDefined();
    expect(
      await updateWorkflowRuleColumn(
        identity,
        rule.id,
        project.id,
        columns.done.id,
      ),
    ).toMatchObject({ columnId: columns.done.id });

    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id))
      .limit(1);
    if (!person) throw new Error("test person was not provisioned");
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );

    expect(
      await updateWorkflowRuleColumn(
        identity,
        rule.id,
        project.id,
        columns.todo.id,
      ),
    ).toBeUndefined();
    expect(await deleteWorkflowRuleById(identity, rule.id)).toBeUndefined();
    const [unchanged] = await db
      .select({ columnId: schema.workflowRuleTable.columnId })
      .from(schema.workflowRuleTable)
      .where(eq(schema.workflowRuleTable.id, rule.id))
      .limit(1);
    expect(unchanged?.columnId).toBe(columns.done.id);
  });
});
