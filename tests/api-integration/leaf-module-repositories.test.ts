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
import { findCustomProviderIdToken } from "../../apps/api/src/oauth/repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
  deleteWorkflowRuleById,
  findWorkflowRuleById,
  insertWorkflowRule,
  updateWorkflowRuleColumn,
} from "../../apps/api/src/workflow-rule/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function seedTask(projectId: string, columnId: string) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Repository task",
        status: "to-do",
        columnId,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning(),
    "seed leaf repository task",
  );
}

describe("current leaf repository reach", () => {
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
    await db.insert(schema.taskActivityTable).values({
      taskId: task.id,
      type: "comment",
      userId: member.user.id,
      content: "current scoped comment body",
    });
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      resourceType: "issue",
      externalId: "external-1",
      url: "https://example.test/issue/1",
    });

    expect(await listTaskCommentRows(identity, task.id)).toHaveLength(1);
    expect(await listExternalLinksByTask(identity, task.id)).toHaveLength(1);
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
