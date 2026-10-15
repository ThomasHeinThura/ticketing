/**
 * #580 batch 3: behaviour pins for the activity, task-relation and time-entry controllers
 * once their statements live in repositories -- authorship predicates on comment
 * update/delete, newest-first activity listing, relation duplicate/self/delete rules and
 * the time-entry list/update shapes.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteOwnComment,
  updateOwnCommentContent,
} from "../../apps/api/src/activity/repository";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { deleteOwnSettingRow } from "../../apps/api/src/user-preference/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessToWorkspaceMembers,
  requireRow,
} from "./helpers/fixtures";

async function world() {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectAccessToWorkspaceMembers(member.workspace.id, project.id);
  const seed = async (number: number, title: string) =>
    requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title,
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number,
          position: number,
        })
        .returning(),
      "task",
    );
  return { member, project, seed };
}

function call(method: string, path: string, body?: unknown) {
  const { app } = createApp();
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("API integration: activity through the repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists activity newest first with blank lines collapsed", async () => {
    const { member, seed } = await world();
    const task = await seed(1, "Task");
    mockAuthenticatedSession(member.user);

    const first = await call("POST", "/api/activity/create", {
      taskId: task.id,
      type: "note",
      message: "first\n\n\nline",
      eventData: { a: 1 },
    });
    expect(first.status).toBe(200);
    await first.text();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await call("POST", "/api/activity/create", {
      taskId: task.id,
      type: "note",
      message: "second",
    });
    await second.text();

    const list = await call("GET", `/api/activity/${task.id}`);
    const rows = (await list.json()) as {
      content: string;
      eventData: unknown;
    }[];
    expect(rows.map((r) => r.content)).toEqual(["second", "first\nline"]);
    expect(rows[1]?.eventData).toEqual({ a: 1 });
    expect(rows[0]?.eventData).toBeNull();
  });

  it("only the author can update or delete a comment; others get 404 and nothing changes", async () => {
    const { member, project, seed } = await world();
    const other = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: member.workspace.id,
      userId: other.user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    await grantProjectAccessToWorkspaceMembers(member.workspace.id, project.id);
    const task = await seed(1, "Task");

    mockAuthenticatedSession(member.user);
    const created = await call("POST", "/api/activity/comment", {
      taskId: task.id,
      comment: "mine",
    });
    const { id } = (await created.json()) as { id: string };

    mockAuthenticatedSession(other.user);
    const foreignUpdate = await call("PUT", "/api/activity/comment", {
      activityId: id,
      comment: "hijack",
    });
    expect(foreignUpdate.status).toBe(404);
    await foreignUpdate.text();
    const foreignDelete = await call("DELETE", "/api/activity/comment", {
      activityId: id,
    });
    expect(foreignDelete.status).toBe(404);
    await foreignDelete.text();
    const [row] = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.id, id));
    expect(row?.content).toBe("mine");

    mockAuthenticatedSession(member.user);
    const event = requireRow(
      await db
        .insert(schema.taskActivityTable)
        .values({
          taskId: task.id,
          type: "status_changed",
          userId: member.user.id,
          content: "event",
        })
        .returning(),
      "activity",
    );
    const notAComment = await call("PUT", "/api/activity/comment", {
      activityId: event.id,
      comment: "rewritten",
    });
    expect(notAComment.status).toBe(404);
    await notAComment.text();
    const notDeletable = await call("DELETE", "/api/activity/comment", {
      activityId: event.id,
    });
    expect(notDeletable.status).toBe(404);
    await notDeletable.text();
    const [eventRow] = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.id, event.id));
    expect(eventRow?.content).toBe("event");

    const updated = await call("PUT", "/api/activity/comment", {
      activityId: id,
      comment: "edited",
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { content: string }).content).toBe(
      "edited",
    );
    const deleted = await call("DELETE", "/api/activity/comment", {
      activityId: id,
    });
    expect(deleted.status).toBe(200);
    await deleted.text();
    expect(
      await db
        .select()
        .from(schema.taskActivityTable)
        .where(eq(schema.taskActivityTable.id, id)),
    ).toHaveLength(0);
  });
});

describe("API integration: task relations through the repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates once, rejects the reverse duplicate with 409 and a self relation with 400, lists both ends, deletes", async () => {
    const { member, seed } = await world();
    const a = await seed(1, "Alpha task");
    const b = await seed(2, "Beta task");
    mockAuthenticatedSession(member.user);

    const created = await call("POST", "/api/task-relation", {
      sourceTaskId: a.id,
      targetTaskId: b.id,
      relationType: "blocks",
    });
    expect(created.status).toBe(200);
    const relation = (await created.json()) as { id: string };

    const reverse = await call("POST", "/api/task-relation", {
      sourceTaskId: b.id,
      targetTaskId: a.id,
      relationType: "blocks",
    });
    expect(reverse.status).toBe(409);
    await reverse.text();

    const otherType = await call("POST", "/api/task-relation", {
      sourceTaskId: b.id,
      targetTaskId: a.id,
      relationType: "related",
    });
    expect(otherType.status).toBe(200);
    await otherType.text();

    const self = await call("POST", "/api/task-relation", {
      sourceTaskId: a.id,
      targetTaskId: a.id,
      relationType: "related",
    });
    expect(self.status).toBe(400);
    await self.text();

    const list = await call("GET", `/api/task-relation/${b.id}`);
    const rows = (await list.json()) as {
      sourceTask: { title: string } | null;
      targetTask: { title: string } | null;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceTask?.title).sort()).toEqual([
      "Alpha task",
      "Beta task",
    ]);

    const removed = await call("DELETE", `/api/task-relation/${relation.id}`);
    expect(removed.status).toBe(200);
    await removed.text();
    const gone = await call("DELETE", `/api/task-relation/${relation.id}`);
    expect(gone.status).toBe(404);
    await gone.text();
  });

  it("a task in another workspace is not a valid relation endpoint", async () => {
    const { member, seed } = await world();
    const mine = await seed(1, "Mine");
    const foreignWorld = await world();
    const theirs = await foreignWorld.seed(1, "Theirs");
    mockAuthenticatedSession(member.user);

    const response = await call("POST", "/api/task-relation", {
      sourceTaskId: mine.id,
      targetTaskId: theirs.id,
      relationType: "related",
    });
    expect(response.status).toBe(404);
    await response.text();
    expect(await db.select().from(schema.taskRelationTable)).toHaveLength(0);
  });
});

describe("API integration: time entries through the repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists by start time with the author's name; update keeps the description unless given", async () => {
    const { member, seed } = await world();
    const task = await seed(1, "Tracked");
    mockAuthenticatedSession(member.user);

    const later = await call("POST", "/api/time-entry", {
      taskId: task.id,
      description: "later",
      startTime: "2026-01-02T09:00:00.000Z",
      endTime: "2026-01-02T10:00:00.000Z",
    });
    expect(later.status).toBe(200);
    await later.text();
    const earlier = await call("POST", "/api/time-entry", {
      taskId: task.id,
      description: "earlier",
      startTime: "2026-01-01T09:00:00.000Z",
    });
    const earlierBody = (await earlier.json()) as { id: string };

    const list = await call("GET", `/api/time-entry/task/${task.id}`);
    const rows = (await list.json()) as {
      description: string;
      userName: string;
    }[];
    expect(rows.map((r) => r.description)).toEqual(["earlier", "later"]);
    expect(rows[0]?.userName).toBe(member.user.name);

    const closed = await call("PUT", `/api/time-entry/${earlierBody.id}`, {
      startTime: "2026-01-01T09:00:00.000Z",
      endTime: "2026-01-01T09:30:00.000Z",
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({
      description: "earlier",
      duration: 1800,
    });

    const renamed = await call("PUT", `/api/time-entry/${earlierBody.id}`, {
      startTime: "2026-01-01T09:00:00.000Z",
      description: "renamed",
    });
    expect(await renamed.json()).toMatchObject({
      description: "renamed",
      duration: 1800,
    });

    const laterRows = (await (
      await call("GET", `/api/time-entry/task/${task.id}`)
    ).json()) as { description: string; duration: number | null }[];
    expect(laterRows[1]).toMatchObject({
      description: "later",
      duration: 3600,
    });

    const fetched = await call("GET", `/api/time-entry/${earlierBody.id}`);
    expect(await fetched.json()).toMatchObject({ description: "renamed" });

    const missing = await call("PUT", "/api/time-entry/nope", {
      startTime: "2026-01-01T09:00:00.000Z",
    });
    expect(missing.status).toBe(404);
    await missing.text();
  });
});

describe("API integration: time entry list ordering", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns entries by start time whatever order they were stored in", async () => {
    const { member, seed } = await world();
    const task = await seed(1, "Tracked");
    for (const [description, hour] of [
      ["third", 12],
      ["first", 8],
      ["second", 10],
    ] as const) {
      await db.insert(schema.timeEntryTable).values({
        taskId: task.id,
        userId: member.user.id,
        description,
        startTime: new Date(Date.UTC(2026, 0, 1, hour)),
      });
    }
    mockAuthenticatedSession(member.user);

    const response = await call("GET", `/api/time-entry/task/${task.id}`);
    const rows = (await response.json()) as { description: string }[];
    expect(rows.map((r) => r.description)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("API integration: repository predicates behind the controllers' own checks", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("comment update/delete need the author and the comment type", async () => {
    const { member, seed } = await world();
    const task = await seed(1, "Task");
    const mine = requireRow(
      await db
        .insert(schema.taskActivityTable)
        .values({
          taskId: task.id,
          type: "comment",
          userId: member.user.id,
          content: "mine",
        })
        .returning(),
      "comment",
    );
    const event = requireRow(
      await db
        .insert(schema.taskActivityTable)
        .values({
          taskId: task.id,
          type: "status_changed",
          userId: member.user.id,
          content: "event",
        })
        .returning(),
      "event",
    );

    expect(
      await updateOwnCommentContent(db, "someone-else", mine.id, "x"),
    ).toBeUndefined();
    expect(await deleteOwnComment(db, "someone-else", mine.id)).toBeUndefined();
    expect(
      await updateOwnCommentContent(db, member.user.id, event.id, "x"),
    ).toBeUndefined();
    expect(
      await deleteOwnComment(db, member.user.id, event.id),
    ).toBeUndefined();
    expect(await db.select().from(schema.taskActivityTable)).toHaveLength(2);

    expect(
      await updateOwnCommentContent(db, member.user.id, mine.id, "edited"),
    ).toMatchObject({ content: "edited" });
    expect(await deleteOwnComment(db, member.user.id, mine.id)).toMatchObject({
      id: mine.id,
    });
  });

  it("deleting a settings row only affects that person's row", async () => {
    const a = await createWorkspaceMember({ role: "member" });
    const b = await createWorkspaceMember({ role: "member" });
    const personOf = async (userId: string) =>
      requireRow(
        await db
          .select({ id: schema.personTable.id })
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, userId)),
        "person",
      ).id;
    const pa = await personOf(a.user.id);
    const pb = await personOf(b.user.id);
    await db.insert(schema.userPreferenceTable).values([
      {
        personId: pa,
        scope: "global",
        scopeId: null,
        key: "density",
        value: "compact",
      },
      {
        personId: pb,
        scope: "global",
        scopeId: null,
        key: "density",
        value: "compact",
      },
    ]);

    await deleteOwnSettingRow(db, pa, {
      scope: "global",
      scopeId: null,
      rowKey: "density",
    });
    const left = await db.select().from(schema.userPreferenceTable);
    expect(left.map((r) => r.personId)).toEqual([pb]);
  });
});
