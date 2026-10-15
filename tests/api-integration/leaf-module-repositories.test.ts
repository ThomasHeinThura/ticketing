/**
 * #580 batch 2: direct tests for the comment, external-link, oauth, intake-flag and
 * realtime-socket repositories. Each function is the single owner of its statement, so
 * these pin the predicates (type/null filters, provider, workspace, soft-delete, reach)
 * and result shape the callers rely on.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listTaskCommentRows } from "../../apps/api/src/comment/repository";
import db, { schema } from "../../apps/api/src/database";
import { listExternalLinksByTask } from "../../apps/api/src/external-link/repository";
import {
  findInstanceIntakeFlag,
  findOrganisationDefaultCustomerVisibility,
  findWorkspaceIntakeFlag,
} from "../../apps/api/src/intake/repository";
import { findCustomAccountIdToken } from "../../apps/api/src/oauth/repository";
import { findReachableLiveProject } from "../../apps/api/src/ws/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function seedTask(projectId: string, columnId: string) {
  const [task] = await db
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
    .returning();
  if (!task) throw new Error("failed to seed task");
  return task;
}

describe("API integration: leaf-module repositories", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("listTaskCommentRows returns only authored, non-empty comments of that task, oldest first", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);

    await db.insert(schema.taskActivityTable).values([
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: "second",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: "first",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: null,
      },
      { taskId: task.id, type: "comment", userId: null, content: "orphan" },
      {
        taskId: task.id,
        type: "task",
        userId: member.user.id,
        content: "not a comment",
      },
    ]);

    const rows = await listTaskCommentRows(task.id);
    expect(rows.map((r) => r.content)).toEqual(["first", "second"]);
    expect(rows[0]).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      userName: member.user.name,
    });
    expect(await listTaskCommentRows("no-such-task")).toEqual([]);
  });

  it("listExternalLinksByTask returns only that task's links", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    const [secondTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Second",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 2,
        position: 2,
      })
      .returning();
    await db.insert(schema.externalLinkTable).values([
      {
        taskId: task.id,
        resourceType: "issue",
        externalId: "1",
        url: "https://example.test/1",
        metadata: '{"a":1}',
      },
      {
        taskId: secondTask?.id ?? "",
        resourceType: "issue",
        externalId: "2",
        url: "https://example.test/2",
      },
    ]);

    const links = await listExternalLinksByTask(task.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      externalId: "1",
      url: "https://example.test/1",
      metadata: '{"a":1}',
    });
    expect(await listExternalLinksByTask("none")).toEqual([]);
  });

  it("findCustomAccountIdToken reads only the user's own `custom` provider account", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const other = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.accountTable).values([
      {
        id: "acct-custom",
        accountId: "a1",
        providerId: "custom",
        userId: member.user.id,
        idToken: "token-custom",
      },
      {
        id: "acct-github",
        accountId: "a2",
        providerId: "github",
        userId: member.user.id,
        idToken: "token-github",
      },
      {
        id: "acct-other",
        accountId: "a3",
        providerId: "custom",
        userId: other.user.id,
        idToken: "token-other",
      },
    ]);

    expect(await findCustomAccountIdToken(member.user.id)).toEqual({
      idToken: "token-custom",
    });
    expect(await findCustomAccountIdToken("nobody")).toBeUndefined();

    const githubOnly = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.accountTable).values({
      id: "acct-github-only",
      accountId: "a4",
      providerId: "github",
      userId: githubOnly.user.id,
      idToken: "token-github-only",
    });
    expect(await findCustomAccountIdToken(githubOnly.user.id)).toBeUndefined();
  });

  it("intake flag lookups read the exact feature key, scoped to the workspace", async () => {
    const mine = await createWorkspaceMember({ role: "admin" });
    const theirs = await createWorkspaceMember({ role: "admin" });
    await db
      .delete(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"));
    expect(await findInstanceIntakeFlag()).toBeUndefined();

    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.sla", enabled: false, locked: false });
    expect(await findInstanceIntakeFlag()).toBeUndefined();

    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.intake", enabled: true, locked: true });
    expect(await findInstanceIntakeFlag()).toEqual({
      enabled: true,
      locked: true,
    });

    await db.insert(schema.workspaceFeatureFlagTable).values([
      {
        workspaceId: mine.workspace.id,
        featureKey: "feature.intake",
        enabled: false,
      },
      {
        workspaceId: theirs.workspace.id,
        featureKey: "feature.intake",
        enabled: true,
      },
      {
        workspaceId: mine.workspace.id,
        featureKey: "feature.sla",
        enabled: true,
      },
    ]);
    expect(await findWorkspaceIntakeFlag(mine.workspace.id)).toEqual({
      enabled: false,
    });
    expect(await findWorkspaceIntakeFlag(theirs.workspace.id)).toEqual({
      enabled: true,
    });
    expect(await findWorkspaceIntakeFlag("none")).toBeUndefined();
  });

  it("findOrganisationDefaultCustomerVisibility returns that organisation's value", async () => {
    const [org] = await db
      .insert(schema.organisationTable)
      .values({
        key: "acme",
        name: "Acme",
        defaultCustomerVisibility: "private",
      })
      .returning();
    expect(
      await findOrganisationDefaultCustomerVisibility(org?.id ?? ""),
    ).toEqual({
      defaultCustomerVisibility: "private",
    });
    expect(
      await findOrganisationDefaultCustomerVisibility("none"),
    ).toBeUndefined();
  });

  it("findReachableLiveProject needs a live project in a workspace the caller belongs to", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const outsider = await createWorkspaceMember({ role: "member" });
    const live = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const archived = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const deleted = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, archived.project.id));
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, deleted.project.id));

    expect(
      await findReachableLiveProject(live.project.id, member.user.id),
    ).toMatchObject({ workspaceId: member.workspace.id });
    expect(
      await findReachableLiveProject(archived.project.id, member.user.id),
    ).toBeUndefined();
    expect(
      await findReachableLiveProject(deleted.project.id, member.user.id),
    ).toBeUndefined();
    expect(
      await findReachableLiveProject(live.project.id, outsider.user.id),
    ).toBeUndefined();
    expect(
      await findReachableLiveProject("none", member.user.id),
    ).toBeUndefined();
  });
});
