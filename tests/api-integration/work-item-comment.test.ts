/**
 * `docs/03-features/comments-and-activity.md` (issue #27): comment CRUD --
 * `POST /api/work-items/{key}/comments`, `PATCH /api/comments/{id}`,
 * `DELETE /api/comments/{id}`. `GET /api/work-items/{key}/activity` and the portal read
 * route are NOT covered here -- see this PR's own body.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  prepareAuthenticatedApiFixture,
} from "./helpers/fixtures";
import {
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

  return user;
}

async function addCustomerIdentity(organisationId: string) {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .then(([row]) => row);
  if (!person) throw new Error("addCustomerIdentity: no person row");
  return { user, person };
}

async function setupWorkItem(role: "member" | "admin" | "viewer" = "member") {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
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

describe("API integration: work-item comments (#27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents = [];
    initEventSubscribers();
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
    await grantProjectRole(creator.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    await grantProjectRole(recipient.id, project.id, [
      "project:read",
      "work_item:read",
    ]);

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
    await grantProjectRole(creator.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
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
    await grantProjectRole(creator.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);

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
    expect(deleted.deletedBy).toBeTruthy();
    expect(deleted.body).toBeNull();

    // Idempotent: deleting again re-returns the same tombstoned row, not an error.
    const again = await deleteComment(app, id);
    expect(again.status).toBe(200);
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
});
