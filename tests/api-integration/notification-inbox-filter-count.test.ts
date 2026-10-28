import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  decodeNotificationInboxCursor,
  listVisibleNotificationInbox,
  markOwnReadableNotificationRead,
  markReadableNotificationsRead,
} from "../../apps/api/src/notification/inbox.repository";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessForWorkspaceRole,
  requireRow,
} from "./helpers/fixtures";

async function createCustomerRequestFixture() {
  const staff = await createWorkspaceMember({ role: "admin" });
  const customerUser = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `customer-inbox-${randomUUID()}`,
        name: "Request owner",
        email: `customer-inbox-${randomUUID()}@example.test`,
      })
      .returning(),
    "customer inbox user",
  );
  const customer = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: customerUser.id,
        organisationId: staff.workspace.organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "customer inbox person",
  );
  await grantCustomerOrganisationMembership(
    staff.workspace.organisationId,
    customer.id,
  );
  const otherUser = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `customer-inbox-other-${randomUUID()}`,
        name: "Different request owner",
        email: `customer-inbox-other-${randomUUID()}@example.test`,
      })
      .returning(),
    "other customer inbox user",
  );
  const otherCustomer = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: otherUser.id,
        organisationId: staff.workspace.organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "other customer inbox person",
  );
  await grantCustomerOrganisationMembership(
    staff.workspace.organisationId,
    otherCustomer.id,
  );
  const { project } = await createProjectFixture({
    workspaceId: staff.workspace.id,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: staff.workspace.organisationId })
    .where(eq(schema.projectTable.id, project.id));
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: staff.workspace.id,
        key: `customer-inbox-${randomUUID()}`,
        name: "Request",
        category: "delivery",
      })
      .returning(),
    "customer inbox work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: staff.workspace.id,
        key: `customer-inbox-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "customer inbox state template",
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
    "customer inbox state",
  );

  async function createRequest(requesterId: string, name: string) {
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: staff.workspace.id,
          projectId: project.id,
          typeId: type.id,
          stateId: state.id,
          number: name === "owned" ? 11 : 12,
          key: `REQ-${name}-${randomUUID().slice(0, 8)}`,
          title: `${name} request`,
          requesterId,
          customerVisibility: "organisation",
        })
        .returning(),
      `${name} work item`,
    );
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: staff.workspace.id,
          key: `customer-inbox-${name}-${randomUUID()}`,
          name: "Customer request",
          group: "General",
          workItemTypeId: type.id,
          formSchema: { fields: [] },
          published: true,
          customerVisible: true,
        })
        .returning(),
      `${name} request type`,
    );
    const requestTypeVersion = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: staff.workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema: { fields: [] },
          workItemTypeId: type.id,
        })
        .returning(),
      `${name} request type version`,
    );
    await db.insert(schema.submissionTable).values({
      organisationId: staff.workspace.organisationId,
      requesterId,
      requestTypeId: requestType.id,
      requestTypeVersionId: requestTypeVersion.id,
      formData: {},
      state: "accepted",
      submittedAt: new Date(),
      customerVisibility: "organisation",
      workItemId: item.id,
    });
    return item;
  }
  return {
    staff,
    customer,
    customerUser,
    otherCustomer,
    otherUser,
    ownRequest: await createRequest(customer.id, "owned"),
    otherRequest: await createRequest(otherCustomer.id, "other"),
  };
}

async function createTask(
  projectId: string,
  columns: { todo: { id: string } },
) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Inbox filter reach",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning(),
    "inbox filter task",
  );
}

async function addTaskNotifications(
  userId: string,
  taskId: string,
  rows: Array<{ type: string; kind?: string; isRead?: boolean; date: Date }>,
) {
  return db
    .insert(schema.notificationTable)
    .values(
      rows.map((row, index) => ({
        userId,
        personId: null,
        type: row.type,
        kind: row.kind ?? null,
        isRead: row.isRead ?? false,
        resourceType: "task",
        resourceId: taskId,
        title: `Inbox row ${index}`,
        createdAt: row.date,
      })),
    )
    .returning({ id: schema.notificationTable.id });
}

describe("notification inbox server filters and unread count", () => {
  beforeEach(async () => resetTestDatabase());

  it("counts all reachable unread rows, filters before paging, and omits unreachable rows", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const projectFixture = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectAccessForWorkspaceRole(
      member.user.id,
      member.workspace.id,
      "admin",
    );
    const task = await createTask(
      projectFixture.project.id,
      projectFixture.columns,
    );

    const newestRows = await addTaskNotifications(
      member.user.id,
      task.id,
      Array.from({ length: 65 }, (_, index) => ({
        type: "task_status_changed",
        isRead: index === 0,
        date: new Date(Date.UTC(2026, 0, 2, 0, 0, index)),
      })),
    );
    await addTaskNotifications(member.user.id, task.id, [
      ...Array.from({ length: 4 }, (_, index) => ({
        type: "task_mention",
        date: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        type: "task_assignee_changed",
        date: new Date(Date.UTC(2025, 11, 31, 0, 0, index)),
      })),
    ]);

    const outsider = await createWorkspaceMember({ role: "admin" });
    const outsiderProject = await createProjectFixture({
      workspaceId: outsider.workspace.id,
    });
    const unreachableTask = await createTask(
      outsiderProject.project.id,
      outsiderProject.columns,
    );
    const [hidden] = await addTaskNotifications(
      member.user.id,
      unreachableTask.id,
      [{ type: "task_status_changed", date: new Date(Date.UTC(2026, 0, 3)) }],
    );

    const all = await listVisibleNotificationInbox({
      userId: member.user.id,
      credentialCanReadTask: true,
      filter: "all",
      limit: 10,
    });
    expect(all.rows).toHaveLength(10);
    expect(all.unreadCount).toBe(71);
    expect(all.nextCursor).toBeTruthy();
    expect(all.rows.some((row) => row.notification.id === hidden?.id)).toBe(
      false,
    );

    const secondPage = await listVisibleNotificationInbox({
      userId: member.user.id,
      credentialCanReadTask: true,
      filter: "all",
      limit: 10,
      cursor: all.nextCursor
        ? (decodeNotificationInboxCursor(all.nextCursor) ?? undefined)
        : undefined,
    });
    expect(secondPage.rows).toHaveLength(10);
    expect(
      secondPage.rows.some((row) =>
        all.rows.some((first) => first.notification.id === row.notification.id),
      ),
    ).toBe(false);

    const mentions = await listVisibleNotificationInbox({
      userId: member.user.id,
      credentialCanReadTask: true,
      filter: "mentions",
      limit: 10,
    });
    const assignments = await listVisibleNotificationInbox({
      userId: member.user.id,
      credentialCanReadTask: true,
      filter: "assignments",
      limit: 10,
    });
    expect(mentions.rows).toHaveLength(4);
    expect(
      mentions.rows.every((row) => row.notification.type === "task_mention"),
    ).toBe(true);
    expect(assignments.rows).toHaveLength(3);
    expect(
      assignments.rows.every(
        (row) => row.notification.type === "task_assignee_changed",
      ),
    ).toBe(true);

    const storedNewest = newestRows[0];
    if (!storedNewest) throw new Error("Expected unread count fixture row");
    const [stored] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(and(eq(schema.notificationTable.id, storedNewest.id)));
    expect(stored?.isRead).toBe(true);
  });

  it("counts, pages, and marks only the customer's own linked requests", async () => {
    const fixture = await createCustomerRequestFixture();
    const ownComment = requireRow(
      await db
        .insert(schema.commentTable)
        .values({
          workspaceId: fixture.staff.workspace.id,
          workItemId: fixture.ownRequest.id,
          authorId: fixture.staff.user.id,
          actorType: "person",
          body: { type: "doc", content: [] },
          visibility: "public",
        })
        .returning(),
      "own request comment",
    );
    const otherComment = requireRow(
      await db
        .insert(schema.commentTable)
        .values({
          workspaceId: fixture.staff.workspace.id,
          workItemId: fixture.otherRequest.id,
          authorId: fixture.staff.user.id,
          actorType: "person",
          body: { type: "doc", content: [] },
          visibility: "public",
        })
        .returning(),
      "other request comment",
    );
    const [ownSubmission] = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.workItemId, fixture.ownRequest.id));
    const [otherSubmission] = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.workItemId, fixture.otherRequest.id));
    if (!ownSubmission || !otherSubmission)
      throw new Error("linked customer submissions missing");
    async function insertNativeNotification(
      resourceType: "work_item" | "comment" | "submission",
      resourceId: string,
      eventKind:
        | "work_item.transitioned"
        | "work_item.commented"
        | "submission.replied",
    ) {
      return requireRow(
        await db
          .insert(schema.notificationTable)
          .values({
            userId: fixture.customerUser.id,
            personId: fixture.customer.id,
            type: eventKind.replaceAll(".", "_"),
            kind: eventKind,
            isRead: false,
            resourceType,
            resourceId,
            eventData: { kind: eventKind },
            title: "Request updated",
            body: "A request changed state.",
          })
          .returning({ id: schema.notificationTable.id }),
        "customer request notification",
      );
    }
    const own = await insertNativeNotification(
      "work_item",
      fixture.ownRequest.id,
      "work_item.transitioned",
    );
    const other = await insertNativeNotification(
      "work_item",
      fixture.otherRequest.id,
      "work_item.transitioned",
    );
    const ownCommentRow = await insertNativeNotification(
      "comment",
      ownComment.id,
      "work_item.commented",
    );
    const otherCommentRow = await insertNativeNotification(
      "comment",
      otherComment.id,
      "work_item.commented",
    );
    const ownSubmissionRow = await insertNativeNotification(
      "submission",
      ownSubmission.id,
      "submission.replied",
    );
    const otherSubmissionRow = await insertNativeNotification(
      "submission",
      otherSubmission.id,
      "submission.replied",
    );

    const inbox = await listVisibleNotificationInbox({
      userId: fixture.customerUser.id,
      credentialCanReadTask: true,
      filter: "all",
      limit: 1,
    });
    expect(inbox.rows).toHaveLength(1);
    expect(inbox.unreadCount).toBe(3);
    expect(inbox.nextCursor).toBeTruthy();
    const visibleResourceIds = [
      ...inbox.rows.map(({ notification }) => notification.resourceId),
    ];
    let cursor = inbox.nextCursor
      ? (decodeNotificationInboxCursor(inbox.nextCursor) ?? undefined)
      : undefined;
    while (cursor) {
      const nextPage = await listVisibleNotificationInbox({
        userId: fixture.customerUser.id,
        credentialCanReadTask: true,
        filter: "all",
        limit: 1,
        cursor,
      });
      expect(nextPage.unreadCount).toBe(3);
      visibleResourceIds.push(
        ...nextPage.rows.map(({ notification }) => notification.resourceId),
      );
      cursor = nextPage.nextCursor
        ? (decodeNotificationInboxCursor(nextPage.nextCursor) ?? undefined)
        : undefined;
    }
    expect(new Set(visibleResourceIds)).toEqual(
      new Set([fixture.ownRequest.id, ownComment.id, ownSubmission.id]),
    );

    await expect(
      markOwnReadableNotificationRead(
        other.id,
        fixture.customerUser.id,
        "read",
      ),
    ).resolves.toBeUndefined();
    await expect(
      markOwnReadableNotificationRead(
        otherCommentRow.id,
        fixture.customerUser.id,
        "read",
      ),
    ).resolves.toBeUndefined();
    await expect(
      markOwnReadableNotificationRead(
        otherSubmissionRow.id,
        fixture.customerUser.id,
        "read",
      ),
    ).resolves.toBeUndefined();
    const [otherBeforeBulk] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, other.id));
    expect(otherBeforeBulk?.isRead).toBe(false);
    await expect(
      markOwnReadableNotificationRead(own.id, fixture.customerUser.id, "read"),
    ).resolves.toMatchObject({ id: own.id, isRead: true });
    await expect(
      markOwnReadableNotificationRead(
        ownCommentRow.id,
        fixture.customerUser.id,
        "read",
      ),
    ).resolves.toMatchObject({ id: ownCommentRow.id, isRead: true });
    await expect(
      markOwnReadableNotificationRead(
        ownSubmissionRow.id,
        fixture.customerUser.id,
        "read",
      ),
    ).resolves.toMatchObject({ id: ownSubmissionRow.id, isRead: true });

    const ownForBulk = await insertNativeNotification(
      "work_item",
      fixture.ownRequest.id,
      "work_item.transitioned",
    );
    const otherForBulk = await insertNativeNotification(
      "comment",
      otherComment.id,
      "work_item.commented",
    );
    await markReadableNotificationsRead(fixture.customerUser.id);
    const states = await db
      .select({
        id: schema.notificationTable.id,
        isRead: schema.notificationTable.isRead,
      })
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, fixture.customerUser.id),
          inArray(schema.notificationTable.id, [
            ownForBulk.id,
            otherForBulk.id,
          ]),
        ),
      );
    expect(states).toEqual(
      expect.arrayContaining([
        { id: ownForBulk.id, isRead: true },
        { id: otherForBulk.id, isRead: false },
      ]),
    );
  });
});
