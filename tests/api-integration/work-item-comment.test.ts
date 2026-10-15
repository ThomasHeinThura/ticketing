/**
 * `docs/03-features/comments-and-activity.md` (issue #27): comment CRUD --
 * `POST /api/work-items/{key}/comments`, `PATCH /api/comments/{id}`,
 * `DELETE /api/comments/{id}`. `GET /api/work-items/{key}/activity` and the portal read
 * route are NOT covered here -- see this PR's own body.
 */
import { createHash, randomUUID } from "node:crypto";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import {
  deleteReadableNotifications,
  listVisibleNotificationRows,
  markOwnReadableNotificationRead,
  markReadableNotificationsRead,
} from "../../apps/api/src/notification/inbox.repository";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessForWorkspaceRole,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";
import {
  raceCommentTombstone,
  raceProjectArchive,
  raceProjectSoftDelete,
  raceWorkItemSoftDelete,
} from "./helpers/race-soft-delete";

type RecordedEvent = { type: string; data: unknown };
let recordedEvents: RecordedEvent[] = [];
let eventSubscribersInitialized = false;

function initEventSubscribers() {
  if (eventSubscribersInitialized) return;
  eventSubscribersInitialized = true;
  subscribeToEvent("work_item.commented", async (data) => {
    recordedEvents.push({ type: "work_item.commented", data });
  });
}

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate)
    throw new Error("makeDefaultState: no state_template row");

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: no state row");
  return state;
}

async function addCustomerIdentity(organisationId: string) {
  let [customerRole] = await db
    .select({
      id: schema.roleTable.id,
      capabilities: schema.roleTable.capabilities,
    })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "organisation"),
        eq(schema.roleTable.key, BUILT_IN_ROLES.customer.key),
        isNull(schema.roleTable.workspaceId),
      ),
    )
    .limit(1);
  if (!customerRole) {
    [customerRole] = await db
      .insert(schema.roleTable)
      .values({
        scope: BUILT_IN_ROLES.customer.scope,
        workspaceId: null,
        key: BUILT_IN_ROLES.customer.key,
        name: "Customer",
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: [...BUILT_IN_ROLES.customer.capabilities],
        isSystem: true,
        isEditable: false,
      })
      .onConflictDoNothing()
      .returning({
        id: schema.roleTable.id,
        capabilities: schema.roleTable.capabilities,
      });
  }
  if (!customerRole) {
    [customerRole] = await db
      .select({
        id: schema.roleTable.id,
        capabilities: schema.roleTable.capabilities,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "organisation"),
          eq(schema.roleTable.key, BUILT_IN_ROLES.customer.key),
          isNull(schema.roleTable.workspaceId),
        ),
      )
      .limit(1);
  }
  if (
    !customerRole ||
    JSON.stringify(customerRole.capabilities) !==
      JSON.stringify(BUILT_IN_ROLES.customer.capabilities)
  ) {
    throw new Error(
      "addCustomerIdentity: canonical customer role is unavailable",
    );
  }
  const user = await db
    .insert(schema.userTable)
    .values({
      id: `customer-${randomUUID()}`,
      email: `customer-${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Customer mention candidate",
    })
    .returning()
    .then(([row]) => row);
  if (!user) throw new Error("addCustomerIdentity: no user row");
  const person = await db
    .insert(schema.personTable)
    .values({
      userId: user.id,
      organisationId,
      side: "customer",
      active: true,
      isPlaceholder: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then(([row]) => row);
  if (!person) throw new Error("addCustomerIdentity: no person row");
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "organisation",
    scopeId: organisationId,
    roleId: customerRole.id,
    seesAll: false,
  });
  return { user, person };
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Integration Test User",
    })
    .returning();
  if (!user) throw new Error("addWorkspaceMember: no user row");

  await prepareAuthenticatedApiFixture(user.id);

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if (role !== "owner") {
    const now = new Date();
    await db
      .insert(schema.workspaceRoleTable)
      .values({
        workspaceId,
        role,
        permission: JSON.stringify({}),
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  await grantProjectAccessForWorkspaceRole(user.id, workspaceId, role);
  return user;
}

async function setupWorkItem(role: "member" | "admin" | "viewer" = "member") {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  await grantWorkItemProjectAccess(creator.user.id, project.id);
  const type = await makeWorkItemType(creator.workspace.id);
  await makeDefaultState(creator.workspace.id, project.id);

  mockAuthenticatedSession(creator.user);
  const { app } = createApp();

  const created = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId: type.id, title: "Work item" }),
  });
  const workItem = (await created.json()) as { key: string; id: string };
  return { creator, project, app, workItem };
}

async function plantNativeNotification(input: {
  userId: string;
  personId: string;
  resourceType: "work_item" | "comment";
  resourceId: string;
  kind: string;
  createdAt?: Date;
}) {
  const [row] = await db
    .insert(schema.notificationTable)
    .values({
      userId: input.userId,
      personId: input.personId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      kind: input.kind,
      type: "info",
      title: "Native resource notice",
      content: "Current reach controls this row",
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("plantNativeNotification: no row returned");
  return row;
}

function postComment(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchComment(
  app: ReturnType<typeof createApp>["app"],
  id: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/comments/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteComment(app: ReturnType<typeof createApp>["app"], id: string) {
  return app.request(`/api/comments/${id}`, { method: "DELETE" });
}

function commentVersions(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  commentId: string,
) {
  return app.request(`/api/work-items/${key}/comments/${commentId}/versions`);
}

function hashApiKeyForTest(key: string) {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApiKeyFor(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "work-item comment scope test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: JSON.stringify(permissions),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

describe("API integration: work-item comments (#27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents = [];
    initEventSubscribers();
  });

  it("SLA-7: sets first response once for a public staff comment by a non-requester", async () => {
    const { creator, app, workItem } = await setupWorkItem("admin");
    const author = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, creator.user.id))
        .limit(1),
      "first response author",
    );
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, workItem.key));
    const workItemRow = requireRow([item], "first response work item");
    await db
      .update(schema.workItemTable)
      .set({ requesterId: author.id })
      .where(eq(schema.workItemTable.id, workItemRow.id));

    const requesterComment = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });
    expect(requesterComment.status).toBe(200);
    const [afterRequester] = await db
      .select({ firstResponseAt: schema.workItemTable.firstResponseAt })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemRow.id));
    expect(afterRequester?.firstResponseAt).toBeNull();

    const organisation = await ensureInternalOrganisation();
    const otherRequester = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: organisation.id,
          side: "staff",
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "other requester person",
    );
    await db
      .update(schema.workItemTable)
      .set({ requesterId: otherRequester.id })
      .where(eq(schema.workItemTable.id, workItemRow.id));

    const internal = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(internal.status).toBe(200);
    const [afterInternal] = await db
      .select({ firstResponseAt: schema.workItemTable.firstResponseAt })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemRow.id));
    expect(afterInternal?.firstResponseAt).toBeNull();

    const publicResponse = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });
    expect(publicResponse.status).toBe(200);
    const firstComment = (await publicResponse.json()) as { createdAt: string };
    const [afterResponse] = await db
      .select({ firstResponseAt: schema.workItemTable.firstResponseAt })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemRow.id));
    expect(afterResponse?.firstResponseAt?.toISOString()).toBe(
      firstComment.createdAt,
    );
  });

  it("CA-1: posts an internal comment and publishes work_item.commented", async () => {
    const { app, workItem } = await setupWorkItem("member");

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });

    expect(response.status).toBe(200);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created.visibility).toBe("internal");
    expect(created.workItemId).toBe(workItem.id);
    expect(created.deletedAt).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recordedEvents).toHaveLength(1);
    const event = recordedEvents[0];
    if (!event) throw new Error("expected one recorded event");
    expect(event.type).toBe("work_item.commented");
    expect((event.data as { visibility: string }).visibility).toBe("internal");
  });

  it("#580 B1: filters native work-item/comment inbox rows before pagination and every mutation", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const [actorPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id));
    if (!actorPerson) throw new Error("expected creator person");
    const commentResponse = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });
    expect(commentResponse.status).toBe(200);
    const comment = (await commentResponse.json()) as { id: string };
    const reachableItem = await plantNativeNotification({
      userId: creator.user.id,
      personId: actorPerson.id,
      resourceType: "work_item",
      resourceId: workItem.id,
      kind: "work_item.assigned",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    });
    const reachableComment = await plantNativeNotification({
      userId: creator.user.id,
      personId: actorPerson.id,
      resourceType: "comment",
      resourceId: comment.id,
      kind: "work_item.mentioned",
    });
    const mismatchUser = await addWorkspaceMember(
      creator.workspace.id,
      "member",
    );
    const [mismatchPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, mismatchUser.id));
    if (!mismatchPerson) throw new Error("expected mismatch person");
    for (let index = 0; index < 55; index += 1) {
      await plantNativeNotification({
        userId: creator.user.id,
        personId: mismatchPerson.id,
        resourceType: "work_item",
        resourceId: workItem.id,
        kind: "work_item.assigned",
      });
    }

    const listBefore = await app.request("/api/notification");
    expect(listBefore.status).toBe(200);
    const listedBefore = (await listBefore.json()) as Array<{ id: string }>;
    expect(listedBefore.map(({ id }) => id)).toContain(reachableItem.id);
    expect(listedBefore.map(({ id }) => id)).toContain(reachableComment.id);
    expect(listedBefore).toHaveLength(2);
    const keyAllowedRows = await listVisibleNotificationRows({
      userId: creator.user.id,
      credentialCanReadTask: false,
      credential: {
        apiKey: {
          id: `notification-key-read-${randomUUID()}`,
          userId: creator.user.id,
          enabled: true,
          permissions: { work_item: ["read"] },
        },
      },
    });
    expect(keyAllowedRows.map(({ notification }) => notification.id)).toContain(
      reachableItem.id,
    );
    expect(keyAllowedRows.map(({ notification }) => notification.id)).toContain(
      reachableComment.id,
    );
    const keyClampedRows = await listVisibleNotificationRows({
      userId: creator.user.id,
      credentialCanReadTask: false,
      credential: {
        apiKey: {
          id: `notification-key-${randomUUID()}`,
          userId: creator.user.id,
          enabled: true,
          permissions: {},
        },
      },
    });
    expect(
      keyClampedRows.map(({ notification }) => notification.id),
    ).not.toContain(reachableItem.id);
    expect(
      keyClampedRows.map(({ notification }) => notification.id),
    ).not.toContain(reachableComment.id);

    await db
      .update(schema.commentTable)
      .set({ deletedAt: new Date(), body: null })
      .where(eq(schema.commentTable.id, comment.id));
    const listAfterTombstone = await app.request("/api/notification");
    const listedAfterTombstone = (await listAfterTombstone.json()) as Array<{
      id: string;
    }>;
    expect(listedAfterTombstone.map(({ id }) => id)).toEqual([
      reachableItem.id,
    ]);
    const hiddenCommentRead = await app.request(
      `/api/notification/${reachableComment.id}/read`,
      { method: "PATCH" },
    );
    expect(hiddenCommentRead.status).toBe(404);
    await app.request("/api/notification/read-all", { method: "PATCH" });
    const commentAfterReadAll = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, reachableComment.id))
      .then(([row]) => row);
    expect(commentAfterReadAll?.isRead).toBe(false);
    await app.request("/api/notification/clear-all", { method: "DELETE" });
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.id, reachableItem.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.id, reachableComment.id)),
    ).toHaveLength(1);

    const revoked = await plantNativeNotification({
      userId: creator.user.id,
      personId: actorPerson.id,
      resourceType: "work_item",
      resourceId: workItem.id,
      kind: "work_item.assigned",
    });
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, actorPerson.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );
    const listAfterRevocation = await app.request("/api/notification");
    expect(
      ((await listAfterRevocation.json()) as Array<{ id: string }>).map(
        ({ id }) => id,
      ),
    ).not.toContain(revoked.id);
    const revokedRead = await app.request(
      `/api/notification/${revoked.id}/read`,
      { method: "PATCH" },
    );
    expect(revokedRead.status).toBe(404);
    await app.request("/api/notification/read-all", { method: "PATCH" });
    await app.request("/api/notification/clear-all", { method: "DELETE" });
    const revokedRow = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, revoked.id))
      .then(([row]) => row);
    expect(revokedRow?.isRead).toBe(false);
  });

  it("#580 B1: applies customer comment visibility and private-item audience on current reach", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const organisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `b1-customer-${randomUUID()}`,
        name: "B1 customer organisation",
        isInternal: false,
        active: true,
        portalAccess: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then(([row]) => row);
    const foreignOrganisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `b1-foreign-${randomUUID()}`,
        name: "B1 foreign organisation",
        isInternal: false,
        active: true,
        portalAccess: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then(([row]) => row);
    if (!organisation || !foreignOrganisation)
      throw new Error("expected customer organisations");
    const requester = await addCustomerIdentity(organisation.id);
    const participant = await addCustomerIdentity(organisation.id);
    const nonparticipant = await addCustomerIdentity(organisation.id);
    const foreign = await addCustomerIdentity(foreignOrganisation.id);
    const [author] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id));
    if (!author) throw new Error("expected staff author");
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    await db
      .update(schema.workItemTable)
      .set({
        requesterId: requester.person.id,
        customerVisibility: "private",
      })
      .where(eq(schema.workItemTable.id, workItem.id));
    await db.insert(schema.requestParticipantTable).values({
      workItemId: workItem.id,
      personId: participant.person.id,
      addedBy: author.id,
      createdAt: new Date(),
    });
    const publicResponse = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });
    const internalResponse = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(publicResponse.status).toBe(200);
    expect(internalResponse.status).toBe(200);
    const publicComment = (await publicResponse.json()) as { id: string };
    const internalComment = (await internalResponse.json()) as { id: string };

    const plantForCustomer = async (
      person: typeof requester.person,
      userId: string,
      resourceType: "work_item" | "comment",
      resourceId: string,
      kind: string,
    ) =>
      plantNativeNotification({
        userId,
        personId: person.id,
        resourceType,
        resourceId,
        kind,
      });
    const people = [requester, participant, nonparticipant, foreign];
    const notifications = new Map<string, string[]>();
    for (const person of people) {
      const itemRow = await plantForCustomer(
        person.person,
        person.user.id,
        "work_item",
        workItem.id,
        "work_item.assigned",
      );
      const publicRow = await plantForCustomer(
        person.person,
        person.user.id,
        "comment",
        publicComment.id,
        "work_item.mentioned",
      );
      const internalRow = await plantForCustomer(
        person.person,
        person.user.id,
        "comment",
        internalComment.id,
        "work_item.mentioned",
      );
      notifications.set(person.user.id, [
        itemRow.id,
        publicRow.id,
        internalRow.id,
      ]);
    }
    for (const person of [requester, participant]) {
      const rows = await listVisibleNotificationRows({
        userId: person.user.id,
        credentialCanReadTask: false,
      });
      const ids = rows.map(({ notification }) => notification.id);
      expect(ids).toContain(notifications.get(person.user.id)?.[0]);
      expect(ids).toContain(notifications.get(person.user.id)?.[1]);
      expect(ids).not.toContain(notifications.get(person.user.id)?.[2]);
    }
    for (const person of [nonparticipant, foreign]) {
      const rows = await listVisibleNotificationRows({
        userId: person.user.id,
        credentialCanReadTask: false,
      });
      const ids = rows.map(({ notification }) => notification.id);
      expect(ids).not.toContain(notifications.get(person.user.id)?.[0]);
      expect(ids).not.toContain(notifications.get(person.user.id)?.[1]);
      expect(ids).not.toContain(notifications.get(person.user.id)?.[2]);
    }

    const requesterItemId = notifications.get(requester.user.id)?.[0];
    const nonparticipantItemId = notifications.get(nonparticipant.user.id)?.[0];
    if (!requesterItemId || !nonparticipantItemId)
      throw new Error("expected private-audience notification fixtures");
    const requesterRead = await markOwnReadableNotificationRead(
      requesterItemId,
      requester.user.id,
    );
    expect(requesterRead?.isRead).toBe(true);
    const [requesterAfterRead] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, requesterItemId));
    expect(requesterAfterRead?.isRead).toBe(true);

    const nonparticipantRead = await markOwnReadableNotificationRead(
      nonparticipantItemId,
      nonparticipant.user.id,
    );
    expect(nonparticipantRead).toBeUndefined();
    const [nonparticipantAfterRead] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, nonparticipantItemId));
    expect(nonparticipantAfterRead?.isRead).toBe(false);
  });

  it("#580 S3: uses the serving project organisation for customer inbox reach", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const makeCustomerOrganisation = async (prefix: string) => {
      const [organisation] = await db
        .insert(schema.organisationTable)
        .values({
          key: `${prefix}-${randomUUID()}`,
          name: prefix,
          isInternal: false,
          active: true,
          portalAccess: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!organisation) throw new Error("expected customer organisation");
      return organisation;
    };
    const customerOrganisation = await makeCustomerOrganisation("serving");
    const foreignOrganisation = await makeCustomerOrganisation("foreign");
    const customer = await addCustomerIdentity(customerOrganisation.id);
    const foreign = await addCustomerIdentity(foreignOrganisation.id);
    const [workspace] = await db
      .select({ organisationId: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, creator.workspace.id));
    expect(workspace?.organisationId).not.toBe(customerOrganisation.id);
    await db
      .update(schema.projectTable)
      .set({ organisationId: customerOrganisation.id })
      .where(eq(schema.projectTable.id, project.id));
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.workItemTable.id, workItem.id));

    const publicResponse = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });
    const internalResponse = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(publicResponse.status).toBe(200);
    expect(internalResponse.status).toBe(200);
    const publicComment = (await publicResponse.json()) as { id: string };
    const internalComment = (await internalResponse.json()) as { id: string };

    const plantFor = (
      identity: typeof customer,
      resourceType: "work_item" | "comment",
      resourceId: string,
      kind: string,
    ) =>
      plantNativeNotification({
        userId: identity.user.id,
        personId: identity.person.id,
        resourceType,
        resourceId,
        kind,
      });
    const customerItem = await plantFor(
      customer,
      "work_item",
      workItem.id,
      "work_item.assigned",
    );
    const customerComment = await plantFor(
      customer,
      "comment",
      publicComment.id,
      "work_item.mentioned",
    );
    const customerInternal = await plantFor(
      customer,
      "comment",
      internalComment.id,
      "work_item.mentioned",
    );
    const missingResource = await plantFor(
      customer,
      "work_item",
      `missing-${randomUUID()}`,
      "work_item.assigned",
    );
    const foreignItem = await plantFor(
      foreign,
      "work_item",
      workItem.id,
      "work_item.assigned",
    );

    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const agentHostList = await app.request("/api/notification");
    expect(agentHostList.status).toBe(401);

    const customerRows = await listVisibleNotificationRows({
      userId: customer.user.id,
      credentialCanReadTask: false,
    });
    const customerIds = customerRows.map(({ notification }) => notification.id);
    expect(customerIds).toContain(customerItem.id);
    expect(customerIds).toContain(customerComment.id);
    expect(customerIds).not.toContain(customerInternal.id);
    expect(customerIds).not.toContain(missingResource.id);

    const foreignRows = await listVisibleNotificationRows({
      userId: foreign.user.id,
      credentialCanReadTask: false,
    });
    expect(
      foreignRows.map(({ notification }) => notification.id),
    ).not.toContain(foreignItem.id);

    const directRead = await markOwnReadableNotificationRead(
      customerItem.id,
      customer.user.id,
    );
    expect(directRead?.isRead).toBe(true);
    const [directlyRead] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, customerItem.id));
    expect(directlyRead?.isRead).toBe(true);

    const refusedDirectRead = await markOwnReadableNotificationRead(
      foreignItem.id,
      foreign.user.id,
    );
    expect(refusedDirectRead).toBeUndefined();
    const [foreignAfterRefusal] = await db
      .select({ isRead: schema.notificationTable.isRead })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, foreignItem.id));
    expect(foreignAfterRefusal?.isRead).toBe(false);

    const customerBulkComment = await plantFor(
      customer,
      "comment",
      publicComment.id,
      "work_item.mentioned",
    );
    await markReadableNotificationsRead(customer.user.id);
    const afterBulkRead = await db
      .select({
        id: schema.notificationTable.id,
        isRead: schema.notificationTable.isRead,
      })
      .from(schema.notificationTable)
      .where(
        inArray(schema.notificationTable.id, [
          customerComment.id,
          customerBulkComment.id,
          customerInternal.id,
          missingResource.id,
        ]),
      );
    expect(afterBulkRead).toEqual(
      expect.arrayContaining([
        { id: customerComment.id, isRead: true },
        { id: customerBulkComment.id, isRead: true },
        { id: customerInternal.id, isRead: false },
        { id: missingResource.id, isRead: false },
      ]),
    );

    const clearItem = await plantFor(
      customer,
      "work_item",
      workItem.id,
      "work_item.assigned",
    );
    const clearInternal = await plantFor(
      customer,
      "comment",
      internalComment.id,
      "work_item.mentioned",
    );
    await deleteReadableNotifications(customer.user.id);
    const afterClear = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(
        inArray(schema.notificationTable.id, [clearItem.id, clearInternal.id]),
      );
    expect(afterClear).toEqual([{ id: clearInternal.id }]);

    await db
      .update(schema.organisationTable)
      .set({ active: false })
      .where(eq(schema.organisationTable.id, customerOrganisation.id));
    const inactiveCustomerRows = await listVisibleNotificationRows({
      userId: customer.user.id,
      credentialCanReadTask: false,
    });
    expect(inactiveCustomerRows).toHaveLength(0);
  });

  it("CA-12: adds an accessible mention as watcher without unmuting and fans out to that person", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const recipient = await addWorkspaceMember(creator.workspace.id, "member");
    const outOfReachUser = await addWorkspaceMember(
      creator.workspace.id,
      "member",
    );
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, recipient.id));
    if (!person) throw new Error("expected recipient person");
    const [outOfReachPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, outOfReachUser.id));
    if (!outOfReachPerson) throw new Error("expected out-of-reach person");
    // This actor is deliberately OUTSIDE project reach: drop the project access the
    // helper gave every added member.
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, outOfReachPerson.id));
    const [projectRole] = await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        workspaceId: creator.workspace.id,
        key: `mention-project-${randomUUID()}`,
        name: "Mention project reach fixture",
        rank: 1,
        capabilities: ["project:read", "work_item:read"],
      })
      .returning();
    if (!projectRole) throw new Error("expected project reach role");
    const [creatorPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id));
    if (!creatorPerson) throw new Error("expected creator person");
    await db
      .insert(schema.membershipTable)
      .values({
        personId: creatorPerson.id,
        scope: "project",
        scopeId: project.id,
        roleId: projectRole.id,
      })
      .onConflictDoNothing();
    await db
      .insert(schema.membershipTable)
      .values({
        personId: person.id,
        scope: "project",
        scopeId: project.id,
        roleId: projectRole.id,
      })
      .onConflictDoNothing();

    await db.insert(schema.watcherTable).values({
      workItemId: workItem.id,
      personId: person.id,
      source: "explicit",
      muted: true,
    });

    const candidatesResponse = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-candidates?visibility=public`,
    );
    expect(candidatesResponse.status).toBe(200);
    const candidates = (await candidatesResponse.json()) as Array<{
      personId: string;
      reachable: boolean;
      userId?: string;
    }>;
    expect(
      candidates.find((candidate) => candidate.personId === person.id),
    ).toMatchObject({ reachable: true });
    expect(
      candidates.find(
        (candidate) => candidate.personId === outOfReachPerson.id,
      ),
    ).toMatchObject({ reachable: false });
    expect(candidates.some((candidate) => candidate.userId !== undefined)).toBe(
      false,
    );

    const preflightResponse = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personIds: [person.id, outOfReachPerson.id],
          visibility: "public",
        }),
      },
    );
    expect(preflightResponse.status).toBe(200);
    expect(await preflightResponse.json()).toEqual({
      reachablePersonIds: [person.id],
      unreachablePersonIds: [outOfReachPerson.id],
    });

    const response = await postComment(app, workItem.key, {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "taskdeskMention", attrs: { id: person.id } },
              { type: "taskdeskMention", attrs: { id: outOfReachPerson.id } },
            ],
          },
        ],
      },
      visibility: "public",
    });

    expect(response.status).toBe(200);
    const [watcher] = await db
      .select({
        source: schema.watcherTable.source,
        muted: schema.watcherTable.muted,
      })
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, workItem.id));
    expect(watcher).toEqual({ source: "explicit", muted: true });

    const notifications = await db
      .select({
        kind: schema.notificationTable.kind,
        personId: schema.notificationTable.personId,
      })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.kind, "work_item.mentioned"));
    expect(notifications).toEqual([
      { kind: "work_item.mentioned", personId: person.id },
    ]);
    const outOfReachWatchers = await db
      .select({ personId: schema.watcherTable.personId })
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.personId, outOfReachPerson.id));
    expect(outOfReachWatchers).toEqual([]);
  });

  it("a narrow owner-bound API key cannot create a comment or mention effects", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const recipient = await addWorkspaceMember(creator.workspace.id, "member");
    const recipientPerson = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, recipient.id))
        .limit(1),
      "narrow-key mention recipient person",
    );

    const rawKey = await createApiKeyFor(creator.user.id, {
      project: ["read"],
      work_item: ["read"],
    });
    const denied = await app.request(
      `/api/work-items/${workItem.key}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": rawKey,
        },
        body: JSON.stringify({
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "taskdeskMention",
                    attrs: { id: recipientPerson.id },
                  },
                ],
              },
            ],
          },
          visibility: "internal",
        }),
      },
    );

    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("Insufficient API key scope");
    expect(
      await db
        .select({ id: schema.commentTable.id })
        .from(schema.commentTable)
        .where(eq(schema.commentTable.workItemId, workItem.id)),
    ).toEqual([]);
    expect(
      await db
        .select({ personId: schema.watcherTable.personId })
        .from(schema.watcherTable)
        .where(eq(schema.watcherTable.workItemId, workItem.id)),
    ).toEqual([]);
    expect(
      await db
        .select({ eventId: schema.outboxTable.eventId })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "work_item.mentioned")),
    ).toEqual([]);
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.kind, "work_item.mentioned")),
    ).toEqual([]);
    expect(recordedEvents).toEqual([]);
  });

  it("a comment-scoped API key permits only its frozen public-comment subset", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const rawKey = await createApiKeyFor(creator.user.id, {
      project: ["read"],
      work_item: ["read"],
      comment: ["create"],
    });
    const headers = {
      "content-type": "application/json",
      "x-api-key": rawKey,
    };

    const publicResponse = await app.request(
      `/api/work-items/${workItem.key}/comments`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: { type: "doc", content: [] },
          visibility: "public",
        }),
      },
    );
    expect(publicResponse.status).toBe(200);

    const internalResponse = await app.request(
      `/api/work-items/${workItem.key}/comments`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: { type: "doc", content: [] },
          visibility: "internal",
        }),
      },
    );
    expect(internalResponse.status).toBe(403);
    expect(await internalResponse.text()).toContain(
      "Insufficient API key scope",
    );
    expect(
      await db
        .select({ id: schema.commentTable.id })
        .from(schema.commentTable)
        .where(eq(schema.commentTable.workItemId, workItem.id)),
    ).toHaveLength(1);
  });

  it("posts a public comment when the caller holds comment:create", async () => {
    const { app, workItem } = await setupWorkItem("member");

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "public",
    });

    expect(response.status).toBe(200);
    const created = (await response.json()) as Record<string, unknown>;
    expect(created.visibility).toBe("public");
  });

  it("#499: project deletion cannot race a comment onto a work item", async () => {
    const { app, project, workItem } = await setupWorkItem("member");

    const race = await raceProjectSoftDelete(
      project.id,
      async () =>
        await postComment(app, workItem.key, {
          body: { type: "doc", content: [] },
          visibility: "public",
        }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const comments = await db
      .select({ id: schema.commentTable.id })
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, workItem.id));
    expect(comments).toHaveLength(0);
    expect(recordedEvents).toHaveLength(0);
  });

  it("403s a caller with no comment:create/comment:create_internal capability", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });

    expect(response.status).toBe(403);
    await response.text();
  });

  it("404s a comment posted to a nonexistent work item key", async () => {
    const { app } = await setupWorkItem("member");
    const response = await postComment(app, "NOPE-999", {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(response.status).toBe(404);
  });

  it("issue #276: 404s a comment posted to a soft-deleted work item, via the shared requireWorkItemReach guard", async () => {
    const { app, workItem } = await setupWorkItem("member");

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, workItem.key));

    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(response.status).toBe(404);
  });

  it("#493: a concurrent soft-delete landing after the reach check cannot slip past this route's own transaction and insert a comment on a dead item", async () => {
    const { app, workItem } = await setupWorkItem("member");

    const race = await raceWorkItemSoftDelete(
      workItem.id,
      async () =>
        await postComment(app, workItem.key, {
          body: { type: "doc", content: [] },
          visibility: "internal",
        }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    const response = race.operation.value;
    // Pre-fix: this route had no in-transaction liveness re-check at all, so the insert
    // landed anyway. Post-fix: the locked re-read sees the now-committed soft-delete and
    // refuses with the same 404 `requireWorkItemReach()` itself would give.
    expect(response.status).toBe(404);

    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, workItem.id));
    expect(comments).toHaveLength(0);
    expect(recordedEvents).toHaveLength(0);
  });

  it("400s a body containing a NUL byte", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const response = await postComment(app, workItem.key, {
      body: { type: "doc", content: [{ type: "text", text: "a\u0000b" }] },
      visibility: "internal",
    });
    expect(response.status).toBe(400);
  });

  it("CA-11: 400s a body over the 256 KiB cap", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const response = await postComment(app, workItem.key, {
      body: {
        type: "doc",
        content: [{ type: "text", text: "x".repeat(300 * 1024) }],
      },
      visibility: "internal",
    });
    expect(response.status).toBe(400);
  });

  it("CA-17: the author may edit their own comment within the 15-minute window", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });

    expect(response.status).toBe(200);
    const updated = (await response.json()) as Record<string, unknown>;
    expect(updated.editedAt).not.toBeNull();

    const [version] = await db
      .select()
      .from(schema.commentVersionTable)
      .where(eq(schema.commentVersionTable.commentId, id));
    expect(version?.number).toBe(1);
  });

  it("a concurrent comment tombstone cannot commit between history-parent and version reads", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    const historicalBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "retained private history" }],
        },
      ],
    };
    await db.insert(schema.commentVersionTable).values({
      commentId: id,
      number: 1,
      body: historicalBody,
      editedBy: creator.user.id,
      createdAt: new Date(),
    });

    const race = await raceCommentTombstone(
      id,
      async () => await commentVersions(app, workItem.key, id),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);
    expect(await race.operation.value.text()).not.toContain(
      "retained private history",
    );

    const [tombstone] = await db
      .select({
        deletedAt: schema.commentTable.deletedAt,
        body: schema.commentTable.body,
      })
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(tombstone?.deletedAt).not.toBeNull();
    expect(tombstone?.body).toBeNull();
    const retainedVersions = await db
      .select({ body: schema.commentVersionTable.body })
      .from(schema.commentVersionTable)
      .where(eq(schema.commentVersionTable.commentId, id));
    expect(retainedVersions).toEqual([{ body: historicalBody }]);
  });

  it("CA-17: refuses an edit outside the 15-minute window for comment:update_own", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    await db
      .update(schema.commentTable)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(schema.commentTable.id, id));

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(response.status).toBe(403);
  });

  it("refuses an edit by a non-author holding only comment:update_own", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const otherUser = await addWorkspaceMember(creator.workspace.id, "member");
    mockAuthenticatedSession(otherUser);

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(response.status).toBe(403);
  });

  it("comment:update_any edits anyone's comment, any time", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    await db
      .update(schema.commentTable)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.commentTable.id, id));

    const admin = await addWorkspaceMember(creator.workspace.id, "admin");
    mockAuthenticatedSession(admin);

    const response = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(response.status).toBe(200);
  });

  it("CA-18: the author may delete their own comment; it tombstones, body cleared", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const response = await deleteComment(app, id);
    expect(response.status).toBe(200);
    const deleted = (await response.json()) as Record<string, unknown>;
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.body).toBeNull();

    // Idempotent: deleting again re-returns the same tombstoned row, not an error.
    const again = await deleteComment(app, id);
    expect(again.status).toBe(200);
  });

  it("CA-18: the activity stream names the deleter, who can differ from the author", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const live = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id: liveId } = (await live.json()) as { id: string };
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const admin = await addWorkspaceMember(creator.workspace.id, "admin");
    mockAuthenticatedSession(admin);
    const response = await deleteComment(app, id);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { deletedBy: string }).deletedBy).toBe(
      admin.id,
    );

    mockAuthenticatedSession(creator.user);
    const activity = await app.request(
      `/api/work-items/${workItem.key}/activity`,
    );
    expect(activity.status).toBe(200);
    const rows = (
      (await activity.json()) as {
        data: Array<{ id: string; deletedBy?: string | null }>;
      }
    ).data;
    const tombstone = rows.find((row) => row.id === id);
    expect(tombstone?.deletedBy).toBe(admin.id);
    expect(tombstone?.deletedBy).not.toBe(creator.user.id);
    // A live comment never carries a deleter.
    expect(rows.find((row) => row.id === liveId)?.deletedBy ?? null).toBeNull();
  });

  it("does not return a tombstoned comment to a member without delete authority", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const ownerDelete = await deleteComment(app, id);
    expect(ownerDelete.status).toBe(200);
    await ownerDelete.text();

    const otherMember = await addWorkspaceMember(
      creator.workspace.id,
      "member",
    );
    mockAuthenticatedSession(otherMember);
    const unauthorizedDelete = await deleteComment(app, id);
    expect(unauthorizedDelete.status).toBe(403);
    await unauthorizedDelete.text();
  });

  it("refuses a delete by a non-author holding only comment:delete_own", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const otherUser = await addWorkspaceMember(creator.workspace.id, "member");
    mockAuthenticatedSession(otherUser);

    const response = await deleteComment(app, id);
    expect(response.status).toBe(403);
  });

  it("404s an update/delete against a comment id from a different tenant", async () => {
    const { app: appA, workItem } = await setupWorkItem("member");
    const created = await postComment(appA, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const otherTenant = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(otherTenant.user);
    const { app: appB } = createApp();

    const patchResponse = await patchComment(appB, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(appB, id);
    expect(deleteResponse.status).toBe(404);
  });

  it("#202's freeze invariant: 404s update/delete against a comment whose project is soft-deleted, row unchanged", async () => {
    const { app, workItem, project } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before soft delete");

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const patchResponse = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);

    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
  });

  it("issue #480: 404s update/delete against a comment whose work item is soft-deleted, row unchanged", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before soft delete");

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, workItem.key));

    const patchResponse = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);

    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
  });

  it("issue #480: 404s update/delete against a comment whose work item is archived, row unchanged", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before archiving");

    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.key, workItem.key));

    const patchResponse = await patchComment(app, id, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);

    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
  });

  it("#499: comment edit and delete wait for project archive and leave the comment unchanged", async () => {
    const { app, project, workItem } = await setupWorkItem("member");
    const created = await postComment(app, workItem.key, {
      body: { type: "doc", content: [{ type: "paragraph" }] },
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };
    const [before] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    if (!before) throw new Error("expected comment row before project archive");

    const race = await raceProjectArchive(project.id, async () =>
      patchComment(app, id, {
        body: {
          type: "doc",
          content: [{ type: "paragraph", text: "changed" }],
        },
      }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const deleteResponse = await deleteComment(app, id);
    expect(deleteResponse.status).toBe(404);
    const [after] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(after).toEqual(before);
    const versions = await db
      .select()
      .from(schema.commentVersionTable)
      .where(eq(schema.commentVersionTable.commentId, id));
    expect(versions).toHaveLength(0);
  });

  it("CA-12: lists and notifies only reachable customers on private work items", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const organisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `private-mention-org-${randomUUID()}`,
        name: "Private mention organisation",
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then(([row]) => row);
    if (!organisation) throw new Error("expected serving organisation");
    const requester = await addCustomerIdentity(organisation.id);
    const participant = await addCustomerIdentity(organisation.id);
    const nonparticipant = await addCustomerIdentity(organisation.id);
    const foreignOrganisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `private-mention-foreign-${randomUUID()}`,
        name: "Foreign mention organisation",
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then(([row]) => row);
    if (!foreignOrganisation) throw new Error("expected foreign organisation");
    const foreignCustomer = await addCustomerIdentity(foreignOrganisation.id);
    const [creatorPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id));
    if (!creatorPerson) throw new Error("expected creator person");

    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    await db
      .update(schema.workItemTable)
      .set({
        requesterId: requester.person.id,
        customerVisibility: "private",
      })
      .where(eq(schema.workItemTable.id, workItem.id));
    await db.insert(schema.requestParticipantTable).values({
      workItemId: workItem.id,
      personId: participant.person.id,
      addedBy: creatorPerson.id,
      createdAt: new Date(),
    });
    await db.insert(schema.watcherTable).values({
      workItemId: workItem.id,
      personId: requester.person.id,
      source: "explicit",
      muted: true,
    });

    const candidateIds = [
      requester.person.id,
      participant.person.id,
      nonparticipant.person.id,
      foreignCustomer.person.id,
    ];
    const candidatesResponse = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-candidates?visibility=public`,
    );
    expect(candidatesResponse.status).toBe(200);
    const candidates = (await candidatesResponse.json()) as Array<{
      personId: string;
      side: string;
      reachable: boolean;
    }>;
    expect(candidates).toContainEqual(
      expect.objectContaining({
        personId: requester.person.id,
        side: "customer",
        reachable: true,
      }),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        personId: participant.person.id,
        side: "customer",
        reachable: true,
      }),
    );
    expect(candidates.map(({ personId }) => personId)).not.toContain(
      nonparticipant.person.id,
    );
    expect(candidates.map(({ personId }) => personId)).not.toContain(
      foreignCustomer.person.id,
    );

    const internalCandidates = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-candidates?visibility=internal`,
    );
    expect(internalCandidates.status).toBe(200);
    const internalCandidateIds = (
      (await internalCandidates.json()) as Array<{ personId: string }>
    ).map(({ personId }) => personId);
    for (const personId of candidateIds)
      expect(internalCandidateIds).not.toContain(personId);

    const publicPreflight = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personIds: candidateIds, visibility: "public" }),
      },
    );
    expect(publicPreflight.status).toBe(200);
    expect(await publicPreflight.json()).toEqual({
      reachablePersonIds: [requester.person.id, participant.person.id],
      unreachablePersonIds: [
        nonparticipant.person.id,
        foreignCustomer.person.id,
      ],
    });
    const internalPreflight = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personIds: candidateIds,
          visibility: "internal",
        }),
      },
    );
    expect(internalPreflight.status).toBe(200);
    expect(await internalPreflight.json()).toEqual({
      reachablePersonIds: [],
      unreachablePersonIds: candidateIds,
    });

    const mentionDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: candidateIds.map((id) => ({
            type: "taskdeskMention",
            attrs: { id },
          })),
        },
      ],
    };
    const publicComment = await postComment(app, workItem.key, {
      body: mentionDocument,
      visibility: "public",
    });
    expect(publicComment.status).toBe(200);

    const customerWatchers = await db
      .select({
        personId: schema.watcherTable.personId,
        source: schema.watcherTable.source,
        muted: schema.watcherTable.muted,
      })
      .from(schema.watcherTable)
      .where(inArray(schema.watcherTable.personId, candidateIds));
    expect(customerWatchers).toHaveLength(2);
    expect(customerWatchers).toContainEqual({
      personId: requester.person.id,
      source: "explicit",
      muted: true,
    });
    expect(customerWatchers).toContainEqual({
      personId: participant.person.id,
      source: "explicit",
      muted: false,
    });

    const publicMentionEvents = await db
      .select({
        kind: schema.outboxTable.kind,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.mentioned"));
    expect(publicMentionEvents).toHaveLength(2);
    expect(
      publicMentionEvents.map(
        ({ payload }) =>
          (payload as { payload: { mentionedPersonId: string } }).payload
            .mentionedPersonId,
      ),
    ).toEqual(
      expect.arrayContaining([requester.person.id, participant.person.id]),
    );

    const internalComment = await postComment(app, workItem.key, {
      body: mentionDocument,
      visibility: "internal",
    });
    expect(internalComment.status).toBe(200);
    const notifications = await db
      .select({ personId: schema.notificationTable.personId })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.kind, "work_item.mentioned"));
    expect(notifications).toHaveLength(2);
    expect(notifications.map(({ personId }) => personId)).toEqual(
      expect.arrayContaining([requester.person.id, participant.person.id]),
    );
    const mentionEventsAfterInternalComment = await db
      .select({
        kind: schema.outboxTable.kind,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.mentioned"));
    expect(mentionEventsAfterInternalComment).toHaveLength(2);
    const watchersAfterInternalComment = await db
      .select({
        personId: schema.watcherTable.personId,
        source: schema.watcherTable.source,
        muted: schema.watcherTable.muted,
      })
      .from(schema.watcherTable)
      .where(inArray(schema.watcherTable.personId, candidateIds));
    expect(watchersAfterInternalComment).toHaveLength(2);
    expect(watchersAfterInternalComment).toContainEqual({
      personId: requester.person.id,
      source: "explicit",
      muted: true,
    });
    expect(watchersAfterInternalComment).toContainEqual({
      personId: participant.person.id,
      source: "explicit",
      muted: false,
    });
  });

  it("CA-13: permits same-organisation customer mentions publicly and excludes them internally", async () => {
    const { app, workItem, creator, project } = await setupWorkItem("member");
    const customerOrganisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `mention-customer-org-${randomUUID()}`,
        name: "Mention customer organisation",
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then(([row]) => row);
    if (!customerOrganisation)
      throw new Error("expected customer organisation");
    const customer = await addCustomerIdentity(customerOrganisation.id);
    const foreignOrganisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `mention-foreign-org-${randomUUID()}`,
        name: "Foreign customer organisation",
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then(([row]) => row);
    if (!foreignOrganisation)
      throw new Error("expected foreign customer organisation");
    const foreignCustomer = await addCustomerIdentity(foreignOrganisation.id);
    await db
      .update(schema.projectTable)
      .set({ organisationId: customerOrganisation.id })
      .where(eq(schema.projectTable.id, project.id));
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.workItemTable.id, workItem.id));

    const publicCandidates = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-candidates?visibility=public`,
    );
    expect(publicCandidates.status).toBe(200);
    const publicCandidateBody = await publicCandidates.json();
    expect(publicCandidateBody).toContainEqual(
      expect.objectContaining({
        personId: customer.person.id,
        side: "customer",
        reachable: true,
      }),
    );
    expect(publicCandidateBody).not.toContainEqual(
      expect.objectContaining({ personId: foreignCustomer.person.id }),
    );

    const internalCandidates = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-candidates?visibility=internal`,
    );
    expect(internalCandidates.status).toBe(200);
    expect(await internalCandidates.json()).not.toContainEqual(
      expect.objectContaining({ personId: customer.person.id }),
    );

    const mentionDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "taskdeskMention", attrs: { id: customer.person.id } },
            {
              type: "taskdeskMention",
              attrs: { id: foreignCustomer.person.id },
            },
          ],
        },
      ],
    };
    const publicPreflight = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personIds: [customer.person.id, foreignCustomer.person.id],
          visibility: "public",
        }),
      },
    );
    expect(publicPreflight.status).toBe(200);
    expect(await publicPreflight.json()).toEqual({
      reachablePersonIds: [customer.person.id],
      unreachablePersonIds: [foreignCustomer.person.id],
    });

    const publicComment = await postComment(app, workItem.key, {
      body: mentionDocument,
      visibility: "public",
    });
    expect(publicComment.status).toBe(200);
    const customerNotifications = await db
      .select({ kind: schema.notificationTable.kind })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.personId, customer.person.id));
    expect(customerNotifications).toEqual([{ kind: "work_item.mentioned" }]);
    const foreignNotifications = await db
      .select({ kind: schema.notificationTable.kind })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.personId, foreignCustomer.person.id));
    expect(foreignNotifications).toEqual([]);
    const foreignWatchers = await db
      .select({ personId: schema.watcherTable.personId })
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.personId, foreignCustomer.person.id));
    expect(foreignWatchers).toEqual([]);

    const internalPreflight = await app.request(
      `/api/work-items/${workItem.key}/comments/mention-preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personIds: [customer.person.id],
          visibility: "internal",
        }),
      },
    );
    expect(internalPreflight.status).toBe(200);
    expect(await internalPreflight.json()).toEqual({
      reachablePersonIds: [],
      unreachablePersonIds: [customer.person.id],
    });
    const internalComment = await postComment(app, workItem.key, {
      body: mentionDocument,
      visibility: "internal",
    });
    expect(internalComment.status).toBe(200);
    const notificationsAfterInternalComment = await db
      .select({ kind: schema.notificationTable.kind })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.personId, customer.person.id));
    expect(notificationsAfterInternalComment).toEqual([
      { kind: "work_item.mentioned" },
    ]);
  });

  it("CA-17: an omitted body is a write-free no-op after the normal edit checks", async () => {
    const { app, workItem } = await setupWorkItem("member");
    const originalBody = { type: "doc", content: [{ type: "paragraph" }] };
    const created = await postComment(app, workItem.key, {
      body: originalBody,
      visibility: "internal",
    });
    const { id } = (await created.json()) as { id: string };

    const response = await patchComment(app, id, {});
    expect(response.status).toBe(200);
    const returned = (await response.json()) as {
      body: unknown;
      editedAt: string | null;
    };
    expect(returned.body).toEqual(originalBody);
    expect(returned.editedAt).toBeNull();

    const [stored] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, id));
    expect(stored?.body).toEqual(originalBody);
    expect(stored?.editedAt).toBeNull();
    const versions = await db
      .select()
      .from(schema.commentVersionTable)
      .where(eq(schema.commentVersionTable.commentId, id));
    expect(versions).toHaveLength(0);
  });

  it("CA-17: an omitted body is still refused for a non-author, outside the window, and on a deleted comment", async () => {
    const { app, workItem, creator } = await setupWorkItem("member");
    const post = async () => {
      const created = await postComment(app, workItem.key, {
        body: { type: "doc", content: [{ type: "paragraph" }] },
        visibility: "internal",
      });
      return ((await created.json()) as { id: string }).id;
    };
    const nonAuthorTarget = await post();
    const staleTarget = await post();
    const deletedTarget = await post();

    await db
      .update(schema.commentTable)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(schema.commentTable.id, staleTarget));
    expect((await patchComment(app, staleTarget, {})).status).toBe(403);

    expect((await deleteComment(app, deletedTarget)).status).toBe(200);
    expect((await patchComment(app, deletedTarget, {})).status).toBe(404);

    const otherUser = await addWorkspaceMember(creator.workspace.id, "member");
    mockAuthenticatedSession(otherUser);
    expect((await patchComment(app, nonAuthorTarget, {})).status).toBe(403);
  });
});
