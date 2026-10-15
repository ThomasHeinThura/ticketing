/**
 * #580 batch 4: direct tests for the notification inbox, scheduler and workflow
 * repositories (and the audit reach lookup), pinning the predicates the controllers rely on:
 * owner scoping on every inbox statement, the audit-alert visibility rule, the reminder
 * window / final-column / opt-out / already-sent rules, the lease claim/release rules and
 * the workflow ownership lookups.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  findPersonIdByUserId,
  holdsWorkspaceSeesAll,
  listProjectMembershipIds,
  listWorkspaceAuditRows,
} from "../../apps/api/src/audit/repository";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteReadableNotifications,
  findOwnNotificationType,
  listVisibleNotificationRows,
  markOwnReadableNotificationRead,
  markReadableNotificationsRead,
} from "../../apps/api/src/notification/inbox.repository";
import {
  claimJobLease,
  insertReminderSent,
  listTasksNeedingReminder,
  releaseJobLease,
} from "../../apps/api/src/scheduler/repository";
import {
  findWorkflowVersion,
  findWorkflowWorkspaceId,
  getMaxVersionNumber,
  insertWorkflow,
  insertWorkflowVersion,
  listReferenceableRoleIds,
  listWorkflowsInWorkspace,
} from "../../apps/api/src/workflow/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessToWorkspaceMembers,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

async function notification(
  userId: string,
  overrides: Partial<typeof schema.notificationTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(schema.notificationTable)
      .values({ userId, type: "info", ...overrides })
      .returning(),
    "notification",
  );
}

describe("API integration: notification inbox repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("every statement is scoped to the owner's rows", async () => {
    const a = await createWorkspaceMember({ role: "member" });
    const b = await createWorkspaceMember({ role: "member" });
    const mine = await notification(a.user.id, { title: "mine" });
    const theirs = await notification(b.user.id, { title: "theirs" });

    const listed = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: true,
    });
    expect(listed.map((r) => r.notification.id)).toEqual([mine.id]);

    expect(await markOwnReadableNotificationRead(theirs.id, a.user.id)).toBe(
      undefined,
    );
    expect(await findOwnNotificationType(theirs.id, a.user.id)).toBe(undefined);
    expect(await findOwnNotificationType(mine.id, a.user.id)).toEqual({
      type: "info",
    });

    await markReadableNotificationsRead(a.user.id);
    const rows = await db.select().from(schema.notificationTable);
    expect(rows.find((r) => r.id === mine.id)?.isRead).toBe(true);
    expect(rows.find((r) => r.id === theirs.id)?.isRead).toBeFalsy();

    await deleteReadableNotifications(a.user.id);
    expect(
      (await db.select().from(schema.notificationTable)).map((r) => r.id),
    ).toEqual([theirs.id]);
  });

  it("hides audit_write_failed alerts unless the reader may read instance alerts, newest first", async () => {
    const a = await createWorkspaceMember({ role: "member" });
    await notification(a.user.id, {
      type: "audit_write_failed",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const older = await notification(a.user.id, {
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = await notification(a.user.id, {
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });

    const plain = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: true,
    });
    expect(plain.map((r) => r.notification.id)).toEqual([newer.id, older.id]);

    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, a.user.id));
    const admin = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: true,
    });
    expect(admin).toHaveLength(3);
  });

  it("task notifications need current reach and a credential that may read tasks", async () => {
    const a = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: a.workspace.id,
    });
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Reach",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );
    const plain = await notification(a.user.id, { title: "plain" });
    await notification(a.user.id, {
      resourceType: "task",
      resourceId: task.id,
    });

    // No project grant: the task row is not readable; the plain row is.
    const noReach = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: true,
    });
    expect(noReach.map((r) => r.notification.id)).toEqual([plain.id]);

    // A credential that may not read tasks never sees task rows.
    const noCredential = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: false,
    });
    expect(noCredential.map((r) => r.notification.id)).toEqual([plain.id]);

    await markReadableNotificationsRead(a.user.id);
    const rows = await db.select().from(schema.notificationTable);
    expect(
      rows.filter((r) => r.resourceType === "task")[0]?.isRead,
    ).toBeFalsy();

    // With project reach the task row becomes visible, unless the credential cannot read tasks.
    await grantProjectAccessToWorkspaceMembers(a.workspace.id, project.id);
    const withReach = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: true,
    });
    expect(withReach).toHaveLength(2);
    const restrictedCredential = await listVisibleNotificationRows({
      userId: a.user.id,
      credentialCanReadTask: false,
    });
    expect(restrictedCredential.map((r) => r.notification.id)).toEqual([
      plain.id,
    ]);
  });
});

describe("API integration: scheduler repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function dueTask(
    workspaceId: string,
    userId: string | null,
    dueDate: Date,
    isFinal = false,
  ) {
    const { project, columns } = await createProjectFixture({ workspaceId });
    const columnId = isFinal ? columns.done.id : columns.todo.id;
    return requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId,
          title: "Due",
          status: "to-do",
          columnId,
          priority: "medium",
          number: 1,
          position: 1,
          dueDate,
        })
        .returning(),
      "task",
    );
  }

  it("overdue window: only assigned, non-final, unreminded, opted-in tasks inside the window", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const other = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    const inWindow = new Date(now.getTime() - 5 * 60 * 1000);
    const start = new Date(now.getTime() - 10 * 60 * 1000);

    const hit = await dueTask(member.workspace.id, member.user.id, inWindow);
    await dueTask(member.workspace.id, null, inWindow);
    await dueTask(member.workspace.id, member.user.id, inWindow, true);
    await dueTask(
      member.workspace.id,
      member.user.id,
      new Date(now.getTime() - 60 * 60 * 1000),
    );
    const optedOut = await dueTask(other.workspace.id, other.user.id, inWindow);
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: other.user.id,
      dueDateReminderEnabled: false,
    });
    const reminded = await dueTask(
      member.workspace.id,
      member.user.id,
      inWindow,
    );
    await insertReminderSent(reminded.id, "overdue");

    const tasks = await listTasksNeedingReminder(start, now, "overdue");
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(hit.id);
    expect(ids).not.toContain(optedOut.id);
    expect(ids).not.toContain(reminded.id);
    expect(tasks.filter((t) => t.userId === null)).toHaveLength(0);
    expect(ids).toHaveLength(1);
  });

  it("configured-before window honours the per-user lead time (default 24h)", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    const start = new Date(now.getTime() - 5 * 60 * 1000);
    // Due in ~24h: default lead time puts its reminder instant at "now".
    const defaultLead = await dueTask(
      member.workspace.id,
      member.user.id,
      new Date(now.getTime() + 24 * 60 * 60 * 1000 - 60 * 1000),
    );
    const farAway = await dueTask(
      member.workspace.id,
      member.user.id,
      new Date(now.getTime() + 72 * 60 * 60 * 1000),
    );

    const ids = (
      await listTasksNeedingReminder(start, now, "configured_before")
    ).map((t) => t.id);
    expect(ids).toContain(defaultLead.id);
    expect(ids).not.toContain(farAway.id);
  });

  it("insertReminderSent records once per task and type", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const task = await dueTask(member.workspace.id, member.user.id, new Date());

    expect(await insertReminderSent(task.id, "overdue")).toBeDefined();
    expect(await insertReminderSent(task.id, "overdue")).toBeUndefined();
    expect(
      await insertReminderSent(task.id, "configured_before"),
    ).toBeDefined();
    expect(await db.select().from(schema.taskReminderSentTable)).toHaveLength(
      2,
    );
  });

  it("a job lease is claimed by one owner until released or expired", async () => {
    expect(await claimJobLease("job-x", "owner-1", "5 minutes")).toBe(true);
    expect(await claimJobLease("job-x", "owner-2", "5 minutes")).toBe(false);

    await releaseJobLease("job-x", "owner-2");
    expect(await claimJobLease("job-x", "owner-2", "5 minutes")).toBe(false);

    await releaseJobLease("job-x", "owner-1");
    expect(await claimJobLease("job-x", "owner-2", "5 minutes")).toBe(true);

    await releaseJobLease("job-x", "owner-2");
    expect(await claimJobLease("job-y", "owner-1", "0 seconds")).toBe(true);
    // The lease is already expired, so a second owner may take it over.
    expect(await claimJobLease("job-y", "owner-2", "5 minutes")).toBe(true);
  });
});

describe("API integration: workflow repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists workflows per workspace, numbers versions and finds them by number", async () => {
    const mine = await createWorkspaceMember({ role: "admin" });
    const theirs = await createWorkspaceMember({ role: "admin" });
    const wf = requireRow(
      [
        await insertWorkflow({
          workspaceId: mine.workspace.id,
          key: "k",
          name: "N",
        }),
      ],
      "workflow",
    );
    await insertWorkflow({
      workspaceId: theirs.workspace.id,
      key: "k",
      name: "Other",
    });

    expect(
      (await listWorkflowsInWorkspace(mine.workspace.id)).map((w) => w.id),
    ).toEqual([wf.id]);
    expect(await findWorkflowWorkspaceId(wf.id)).toEqual({
      workspaceId: mine.workspace.id,
    });
    expect(await findWorkflowWorkspaceId("none")).toBeUndefined();

    const otherWf = await insertWorkflow({
      workspaceId: theirs.workspace.id,
      key: "k2",
      name: "Other 2",
    });
    await insertWorkflowVersion(db, {
      workflowId: otherWf?.id ?? "",
      number: 7,
    });
    expect((await getMaxVersionNumber(db, wf.id))?.nextNumber).toBeNull();
    const v1 = await insertWorkflowVersion(db, {
      workflowId: wf.id,
      number: 1,
    });
    await insertWorkflowVersion(db, { workflowId: wf.id, number: 2 });
    expect((await getMaxVersionNumber(db, wf.id))?.nextNumber).toBe(2);

    expect((await findWorkflowVersion(wf.id, 1))?.id).toBe(v1?.id);
    expect(await findWorkflowVersion(wf.id, 3)).toBeUndefined();
    expect(await findWorkflowVersion("none", 1)).toBeUndefined();
  });

  it("a duplicate key within a workspace violates the unique constraint", async () => {
    const mine = await createWorkspaceMember({ role: "admin" });
    await insertWorkflow({
      workspaceId: mine.workspace.id,
      key: "dup",
      name: "A",
    });
    await expect(
      insertWorkflow({ workspaceId: mine.workspace.id, key: "dup", name: "B" }),
    ).rejects.toThrow();
  });

  it("referenceable roles are the workspace's own plus the built-in ones, never another workspace's", async () => {
    const mine = await createWorkspaceMember({ role: "admin" });
    const theirs = await createWorkspaceMember({ role: "admin" });
    const now = new Date();
    const mk = async (workspaceId: string | null, key: string) =>
      requireRow(
        await db
          .insert(schema.roleTable)
          .values({
            workspaceId,
            key,
            name: key,
            scope: "workspace",
            rank: 1,
            capabilities: [],
            createdAt: now,
            updatedAt: now,
          } as typeof schema.roleTable.$inferInsert)
          .returning(),
        "role",
      );
    const own = await mk(mine.workspace.id, "own");
    const builtIn = await mk(null, "builtin");
    const foreign = await mk(theirs.workspace.id, "foreign");

    const ids = (await listReferenceableRoleIds(mine.workspace.id)).map(
      (r) => r.id,
    );
    expect(ids).toContain(own.id);
    expect(ids).toContain(builtIn.id);
    expect(ids).not.toContain(foreign.id);
  });
});

describe("API integration: audit repository reach lookups", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("filters project rows by reach and ignores other workspaces", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ role: "admin" });
    const { project: p1 } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: p2 } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const row = (
      workspaceId: string,
      projectId: string | null,
      action: string,
    ) =>
      appendAuditLog(db, {
        actorId: member.user.id,
        actorType: "person",
        workspaceId,
        projectId,
        action,
        entityType: "x",
        entityId: "y",
      });
    await row(member.workspace.id, null, "auth.sign_in_succeeded");
    await row(member.workspace.id, p1.id, "role.updated");
    await row(member.workspace.id, p2.id, "role.deleted");
    await row(other.workspace.id, null, "auth.sign_out");

    const actions = async (reach: "all" | string[], q = {}) =>
      (
        await listWorkspaceAuditRows(member.workspace.id, reach, {
          limit: 50,
          ...q,
        })
      )
        .map((r) => r.action)
        .sort();

    expect(await actions("all")).toEqual([
      "auth.sign_in_succeeded",
      "role.deleted",
      "role.updated",
    ]);
    expect(await actions([])).toEqual(["auth.sign_in_succeeded"]);
    expect(await actions([p1.id])).toEqual([
      "auth.sign_in_succeeded",
      "role.updated",
    ]);
    expect(await actions("all", { action: "role." })).toEqual([
      "role.deleted",
      "role.updated",
    ]);
    expect(await actions("all", { action: "role_" })).toEqual([]);
    expect(await actions("all", { limit: 1 })).toHaveLength(1);
  });

  it("person, sees_all and project membership lookups", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const person = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, member.user.id)),
      "person",
    );
    expect(await findPersonIdByUserId(member.user.id)).toEqual({
      id: person.id,
    });
    expect(await findPersonIdByUserId("nobody")).toBeUndefined();
    expect(await holdsWorkspaceSeesAll(person.id, member.workspace.id)).toBe(
      false,
    );
    expect(await listProjectMembershipIds(person.id)).toEqual([]);

    // A project-scope membership counts as project reach but is not sees_all.
    await grantProjectRole(member.user.id, project.id, ["work_item:read"]);
    expect(await listProjectMembershipIds(person.id)).toEqual([project.id]);
    expect(await holdsWorkspaceSeesAll(person.id, member.workspace.id)).toBe(
      false,
    );

    // A workspace-scope membership without sees_all does not count either.
    const now = new Date();
    const plainRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: member.workspace.id,
          key: "plain-workspace-role",
          name: "Plain",
          rank: 1,
          capabilities: ["workspace:read"],
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "role",
    );
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "workspace",
      scopeId: member.workspace.id,
      roleId: plainRole.id,
      seesAll: false,
      createdAt: now,
      updatedAt: now,
    });
    expect(await holdsWorkspaceSeesAll(person.id, member.workspace.id)).toBe(
      false,
    );

    // sees_all on this workspace only; another workspace is unaffected.
    await db
      .update(schema.membershipTable)
      .set({ seesAll: true })
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "workspace"),
        ),
      );
    expect(await holdsWorkspaceSeesAll(person.id, member.workspace.id)).toBe(
      true,
    );
    expect(await holdsWorkspaceSeesAll(person.id, "other-workspace")).toBe(
      false,
    );
    expect(await listProjectMembershipIds(person.id)).toEqual([project.id]);
  });
});
